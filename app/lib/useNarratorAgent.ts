import { useCallback, useEffect, useRef, useState } from "react"
import { useFetcher } from "react-router"
import {
  GoogleGenAI,
  type LiveServerMessage,
  Modality,
} from "@google/genai/web"
import { initializeAudio, stopPlayback } from "~/lib/audio-utils"
import type {
  ConnectionState,
  Session,
  StoryConfig,
  TranscriptEntry,
  UseNarratorAgentReturn,
} from "~/lib/gemini-live.types"
import { buildNarratorSystemInstruction, MODEL } from "~/lib/story-agent-config"
import {
  createHandleModelTurn,
  createHandleTurnNarrator,
  createWaitMessage,
} from "~/lib/live-turn-handlers"

export type { UseNarratorAgentReturn }

export function useNarratorAgent(
  storyConfig: StoryConfig | null,
): UseNarratorAgentReturn {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected")
  const [error, setError] = useState<string | null>(null)
  const [transcriptLines, setTranscriptLines] = useState<TranscriptEntry[]>([])

  const sessionRef = useRef<Session | null>(null)
  const queueRef = useRef<LiveServerMessage[]>([])
  const audioPartsRef = useRef<string[]>([])
  const mimeTypeRef = useRef<string>("audio/pcm;rate=24000")
  const handleTurnNarratorRef = useRef<(() => Promise<void>) | null>(null)
  const isHandlingTurnRef = useRef(false)
  const pendingConnectRef = useRef(false)
  const mountedRef = useRef(true)

  const fetcher = useFetcher<{ token?: string; error?: string }>()
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const disconnect = useCallback(() => {
    sessionRef.current?.close()
    sessionRef.current = null
    handleTurnNarratorRef.current = null
    queueRef.current = []
    audioPartsRef.current = []
    stopPlayback()
    setConnectionState("disconnected")
    setError(null)
    setTranscriptLines([])
  }, [])

  const connect = useCallback(async () => {
    if (!storyConfig) {
      setError("No story config; complete setup first.")
      return
    }
    if (pendingConnectRef.current || sessionRef.current) return
    setError(null)
    setConnectionState("connecting")
    try {
      await initializeAudio()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Audio init failed")
      setConnectionState("disconnected")
      return
    }
    pendingConnectRef.current = true
    fetcherRef.current.submit({}, { method: "POST", action: "/api/gemini-token" })
  }, [storyConfig])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (
      !storyConfig ||
      !pendingConnectRef.current ||
      connectionState !== "connecting"
    )
      return
    if (fetcher.state !== "idle") return

    pendingConnectRef.current = false
    const data = fetcher.data as
      | { token?: string; error?: string }
      | null
      | undefined
    if (data == null) {
      setError(
        "Token request failed. Check that GEMINI_API_KEY is set on the server.",
      )
      setConnectionState("disconnected")
      return
    }

    if (data.error) {
      setError(data.error)
      setConnectionState("disconnected")
      return
    }

    const token = data.token
    if (!token) {
      setError("No token returned")
      setConnectionState("disconnected")
      return
    }

    const ai = new GoogleGenAI({
      apiKey: token,
      httpOptions: { apiVersion: "v1alpha" as const },
    })

    const handleModelTurn = createHandleModelTurn({
      setTranscriptLines,
      audioPartsRef,
      mimeTypeRef,
    })
    const waitMessage = createWaitMessage(queueRef, handleModelTurn)
    const handleTurnNarrator = createHandleTurnNarrator(waitMessage)
    handleTurnNarratorRef.current = handleTurnNarrator

    ai.live
      .connect({
        model: MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          enableAffectiveDialog: true,
          proactivity: { proactiveAudio: true },
          systemInstruction: buildNarratorSystemInstruction(
            storyConfig.shortPlot,
          ),
          thinkingConfig: { thinkingBudget: 0 },
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: storyConfig.voiceName },
            },
          },
          outputAudioTranscription: {},
          contextWindowCompression: {
            triggerTokens: "104857",
            slidingWindow: { targetTokens: "52428" },
          },
        },
        callbacks: {
          onopen: () => {
            if (mountedRef.current) setConnectionState("connected")
          },
          onmessage: (message: LiveServerMessage) => {
            queueRef.current.push(message)
          },
          onerror: (e: ErrorEvent) => {
            if (mountedRef.current) {
              setError(e?.message ?? "Connection error")
              disconnect()
            }
          },
          onclose: () => {
            if (mountedRef.current) disconnect()
          },
        },
      })
      .then((session) => {
        if (!mountedRef.current) {
          session.close()
          return
        }
        sessionRef.current = session
        sendTurn("start")
      })
      .catch((err) => {
        if (!mountedRef.current) return
        const message = err instanceof Error ? err.message : "Failed to connect"
        setError(message)
        setConnectionState("disconnected")
      })
  }, [fetcher.state, fetcher.data, disconnect, storyConfig])

  const sendTurn = useCallback((text: string) => {
    const session = sessionRef.current
    if (!session) return
    if (isHandlingTurnRef.current) return
    setTranscriptLines((prev) => [...prev, { role: "user", text }])
    session.sendRealtimeInput({ text: text })

    const handleTurnNarrator = handleTurnNarratorRef.current
    if (!handleTurnNarrator) return
    isHandlingTurnRef.current = true
    handleTurnNarrator()
      .finally(() => {
        isHandlingTurnRef.current = false
      })
      .catch(() => {})
  }, [])

  const transcript = transcriptLines
    .map((e) => `${e.role === "user" ? "You" : "Agent"}: ${e.text}`)
    .join("\n\n")

  return {
    connectionState,
    error,
    transcript,
    connect,
    disconnect,
    sendTurn,
  }
}
