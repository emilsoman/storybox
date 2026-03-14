import { useCallback, useEffect, useRef, useState } from "react"
import { useFetcher } from "react-router"
import {
  GoogleGenAI,
  type LiveServerMessage,
  Modality,
  FunctionResponseScheduling,
} from "@google/genai/web"
import { initializeAudio, stopPlayback } from "~/lib/audio-utils"
import type {
  ConnectionState,
  Session,
  StoryConfig,
  TranscriptEntry,
  UseGeminiLiveReturn,
} from "~/lib/gemini-live.types"
import {
  buildNarratorSystemInstruction,
  MODEL,
  STORY_SETUP_SYSTEM_INSTRUCTION,
  START_STORY_TOOL,
} from "~/lib/story-agent-config"
import {
  createHandleModelTurn,
  createHandleTurnNarrator,
  createHandleTurnSetup,
  createWaitMessage,
} from "~/lib/live-turn-handlers"

export type { ConnectionState, StoryConfig, UseGeminiLiveReturn }

export function useGeminiLive(): UseGeminiLiveReturn {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected")
  const [error, setError] = useState<string | null>(null)
  const [transcriptLines, setTranscriptLines] = useState<TranscriptEntry[]>([])
  const [storySetup, setStorySetup] = useState<string | null>(null)
  const [storyStarted, setStoryStarted] = useState(false)
  const [storyConfig, setStoryConfig] = useState<StoryConfig | null>(null)

  const sessionRef = useRef<Session | null>(null)
  const storySetupAbortRef = useRef<AbortController | null>(null)
  const storyConfigRef = useRef<StoryConfig | null>(null)
  const replacingWithStoryRef = useRef(false)
  const queueRef = useRef<LiveServerMessage[]>([])
  const audioPartsRef = useRef<string[]>([])
  const mimeTypeRef = useRef<string>("audio/pcm;rate=24000")
  const handleTurnSetupRef = useRef<
    (() => Promise<LiveServerMessage | null>) | null
  >(null)
  const handleTurnNarratorRef = useRef<(() => Promise<void>) | null>(null)
  const isHandlingTurnRef = useRef(false)
  const pendingConnectRef = useRef(false)
  const transcriptLinesRef = useRef<TranscriptEntry[]>([])
  const storySetupRef = useRef<string | null>(null)
  transcriptLinesRef.current = transcriptLines
  storySetupRef.current = storySetup

  const fetcher = useFetcher<{ token?: string; error?: string }>()

  const disconnect = useCallback(() => {
    sessionRef.current?.close()
    sessionRef.current = null
    handleTurnSetupRef.current = null
    handleTurnNarratorRef.current = null
    queueRef.current = []
    audioPartsRef.current = []
    storySetupAbortRef.current?.abort()
    storySetupAbortRef.current = null
    storyConfigRef.current = null
    replacingWithStoryRef.current = false
    stopPlayback()
    setConnectionState("disconnected")
    setError(null)
    setTranscriptLines([])
    setStorySetup(null)
    setStoryStarted(false)
    setStoryConfig(null)
  }, [])

  const connect = useCallback(async () => {
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
    fetcher.submit({}, { method: "POST", action: "/api/gemini-token" })
  }, [fetcher])

  useEffect(() => {
    if (!pendingConnectRef.current || connectionState !== "connecting") return
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
    const handleTurnSetup = createHandleTurnSetup(waitMessage)
    const handleTurnNarrator = createHandleTurnNarrator(waitMessage)
    handleTurnSetupRef.current = handleTurnSetup
    handleTurnNarratorRef.current = handleTurnNarrator

    const configForSession = storyConfigRef.current
    const systemInstruction = configForSession
      ? buildNarratorSystemInstruction(configForSession.shortPlot)
      : STORY_SETUP_SYSTEM_INSTRUCTION
    const voiceName = configForSession?.voiceName ?? "Zephyr"
    const tools = configForSession
      ? undefined
      : [{ functionDeclarations: [START_STORY_TOOL] }]

    ai.live
      .connect({
        model: MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          enableAffectiveDialog: true,
          proactivity: { proactiveAudio: true },
          systemInstruction,
          thinkingConfig: { thinkingBudget: 0 },
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
          outputAudioTranscription: {},
          contextWindowCompression: {
            triggerTokens: "104857",
            slidingWindow: { targetTokens: "52428" },
          },
          ...(tools && { tools }),
        },
        callbacks: {
          onopen: () => {
            setConnectionState("connected")
            console.log("onopen")
          },
          onmessage: (message: LiveServerMessage) => {
            queueRef.current.push(message)
          },
          onerror: (e: ErrorEvent) => {
            setError(e?.message ?? "Connection error")
          },
          onclose: () => {
            if (replacingWithStoryRef.current) {
              replacingWithStoryRef.current = false
            } else {
              disconnect()
            }
          },
        },
      })
      .then((session) => {
        console.log("session set")
        sessionRef.current = session
        const message = "start"
        sendTurn(message)
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : "Failed to connect"
        setError(message)
        setConnectionState("disconnected")
      })
  }, [connectionState, fetcher.state, fetcher.data, disconnect])

  const sendTurn = useCallback(
    (text: string) => {
      const session = sessionRef.current
      if (!session) return
      if (isHandlingTurnRef.current) return
      setTranscriptLines((prev) => [...prev, { role: "user", text }])
      session.sendRealtimeInput({ text: text })

      const isNarrator = !!storyConfigRef.current

      if (isNarrator) {
        const handleTurnNarrator = handleTurnNarratorRef.current
        if (!handleTurnNarrator) return
        isHandlingTurnRef.current = true
        handleTurnNarrator()
          .finally(() => {
            isHandlingTurnRef.current = false
          })
          .catch(() => {})
        return
      }

      // Story setup loop: update story setup from transcript, then handle turn (may get start_story)
      const transcriptForSetup = [
        ...transcriptLines,
        { role: "user" as const, text },
      ]
        .map((e) => `${e.role === "user" ? "You" : "Agent"}: ${e.text}`)
        .join("\n\n")
      storySetupAbortRef.current?.abort()
      const controller = new AbortController()
      storySetupAbortRef.current = controller
      fetch("/api/story-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: transcriptForSetup }),
        signal: controller.signal,
      })
        .then((res) =>
          res.ok
            ? res.json()
            : Promise.reject(new Error("Story setup request failed")),
        )
        .then((data: { markdown?: string }) => {
          if (typeof data.markdown === "string") setStorySetup(data.markdown)
        })
        .catch(() => {})
        .finally(() => {
          if (storySetupAbortRef.current === controller) {
            storySetupAbortRef.current = null
          }
        })

      const handleTurnSetup = handleTurnSetupRef.current
      if (!handleTurnSetup) return
      isHandlingTurnRef.current = true
      handleTurnSetup()
        .then(async (lastMessage) => {
          const toolCall = lastMessage?.toolCall
          if (!sessionRef.current || !toolCall?.functionCalls?.length) return
          const isStartStory = toolCall.functionCalls.some(
            (fc) => fc.name === "start_story",
          )
          if (!isStartStory) return

          const transcriptForPrepare = transcriptLinesRef.current
            .map((e) => `${e.role === "user" ? "You" : "Agent"}: ${e.text}`)
            .join("\n\n")
          const storySetupForPrepare = storySetupRef.current ?? ""

          let prepareResult: StoryConfig
          try {
            const res = await fetch("/api/prepare-story", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                storySetup: storySetupForPrepare,
                transcript: transcriptForPrepare,
              }),
            })
            if (!res.ok) throw new Error("Prepare story failed")
            const data = (await res.json()) as StoryConfig
            prepareResult = {
              shortPlot: data.shortPlot ?? "",
              lucideIconNames: Array.isArray(data.lucideIconNames)
                ? data.lucideIconNames.filter(
                    (x): x is string => typeof x === "string",
                  )
                : [],
              voiceName:
                typeof data.voiceName === "string" ? data.voiceName : "Zephyr",
            }
          } catch {
            prepareResult = {
              shortPlot: "",
              lucideIconNames: [],
              voiceName: "Zephyr",
            }
          }

          setStoryConfig(prepareResult)
          setStoryStarted(true)
          storyConfigRef.current = prepareResult
          replacingWithStoryRef.current = true

          const functionResponses = toolCall.functionCalls.map((fc) => ({
            id: fc.id,
            name: fc.name,
            response: {
              result: "ok",
              plot: prepareResult.shortPlot,
            } as Record<string, unknown>,
            scheduling: FunctionResponseScheduling.WHEN_IDLE,
          }))
          sessionRef.current?.sendToolResponse({ functionResponses })
          await handleTurnSetupRef.current?.()
          sessionRef.current?.close()
          sessionRef.current = null
          connect()
        })
        .finally(() => {
          isHandlingTurnRef.current = false
        })
        .catch(() => {})
    },
    [transcriptLines, connect],
  )

  const transcript = transcriptLines
    .map((e) => `${e.role === "user" ? "You" : "Agent"}: ${e.text}`)
    .join("\n\n")

  return {
    connectionState,
    error,
    transcript,
    storySetup,
    storyStarted,
    storyConfig,
    connect,
    disconnect,
    sendTurn,
  }
}
