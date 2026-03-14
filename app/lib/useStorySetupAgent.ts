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
  UseStorySetupAgentReturn,
} from "~/lib/gemini-live.types"
import {
  MODEL,
  STORY_SETUP_SYSTEM_INSTRUCTION,
  START_STORY_TOOL,
} from "~/lib/story-agent-config"
import {
  createHandleModelTurn,
  createHandleTurnSetup,
  createWaitMessage,
} from "~/lib/live-turn-handlers"

export type { UseStorySetupAgentReturn }

export function useStorySetupAgent(): UseStorySetupAgentReturn {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected")
  const [error, setError] = useState<string | null>(null)
  const [transcriptLines, setTranscriptLines] = useState<TranscriptEntry[]>([])
  const [storySetup, setStorySetup] = useState<string | null>(null)
  const [storyConfig, setStoryConfig] = useState<StoryConfig | null>(null)
  const [setupDone, setSetupDone] = useState(false)

  const sessionRef = useRef<Session | null>(null)
  const storySetupAbortRef = useRef<AbortController | null>(null)
  const queueRef = useRef<LiveServerMessage[]>([])
  const audioPartsRef = useRef<string[]>([])
  const mimeTypeRef = useRef<string>("audio/pcm;rate=24000")
  const handleTurnSetupRef = useRef<
    (() => Promise<LiveServerMessage | null>) | null
  >(null)
  const isHandlingTurnRef = useRef(false)
  const pendingConnectRef = useRef(false)
  const transcriptLinesRef = useRef<TranscriptEntry[]>([])
  const storySetupRef = useRef<string | null>(null)
  const isTransitioningToNarratorRef = useRef(false)
  transcriptLinesRef.current = transcriptLines
  storySetupRef.current = storySetup

  const fetcher = useFetcher<{ token?: string; error?: string }>()

  const disconnect = useCallback(() => {
    sessionRef.current?.close()
    sessionRef.current = null
    handleTurnSetupRef.current = null
    queueRef.current = []
    audioPartsRef.current = []
    storySetupAbortRef.current?.abort()
    storySetupAbortRef.current = null
    stopPlayback()
    setConnectionState("disconnected")
    setError(null)
    setTranscriptLines([])
    setStorySetup(null)
    setStoryConfig(null)
    setSetupDone(false)
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
    handleTurnSetupRef.current = handleTurnSetup

    ai.live
      .connect({
        model: MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          enableAffectiveDialog: true,
          proactivity: { proactiveAudio: true },
          systemInstruction: STORY_SETUP_SYSTEM_INSTRUCTION,
          thinkingConfig: { thinkingBudget: 0 },
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: "Zephyr" },
            },
          },
          outputAudioTranscription: {},
          contextWindowCompression: {
            triggerTokens: "104857",
            slidingWindow: { targetTokens: "52428" },
          },
          tools: [{ functionDeclarations: [START_STORY_TOOL] }],
        },
        callbacks: {
          onopen: () => {
            setConnectionState("connected")
          },
          onmessage: (message: LiveServerMessage) => {
            queueRef.current.push(message)
          },
          onerror: (e: ErrorEvent) => {
            setError(e?.message ?? "Connection error")
          },
          onclose: () => {
            if (isTransitioningToNarratorRef.current) {
              isTransitioningToNarratorRef.current = false
              sessionRef.current = null
              handleTurnSetupRef.current = null
              queueRef.current = []
              audioPartsRef.current = []
              storySetupAbortRef.current?.abort()
              storySetupAbortRef.current = null
              stopPlayback()
              setConnectionState("disconnected")
              return
            }
            disconnect()
          },
        },
      })
      .then((session) => {
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
              ...(typeof data.coverImageBase64 === "string" &&
                data.coverImageBase64 && {
                  coverImageBase64: data.coverImageBase64,
                  coverImageMimeType:
                    typeof data.coverImageMimeType === "string"
                      ? data.coverImageMimeType
                      : "image/png",
                }),
            }
          } catch {
            prepareResult = {
              shortPlot: "",
              lucideIconNames: [],
              voiceName: "Zephyr",
            }
          }

          setStoryConfig(prepareResult)

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
          setSetupDone(true)
          isTransitioningToNarratorRef.current = true
          sessionRef.current?.close()
          sessionRef.current = null
          handleTurnSetupRef.current = null
          queueRef.current = []
          audioPartsRef.current = []
          storySetupAbortRef.current?.abort()
          storySetupAbortRef.current = null
          stopPlayback()
          setConnectionState("disconnected")
          setError(null)
          setTranscriptLines([])
          setStorySetup(null)
        })
        .finally(() => {
          isHandlingTurnRef.current = false
        })
        .catch(() => {})
    },
    [transcriptLines, disconnect],
  )

  const transcript = transcriptLines
    .map((e) => `${e.role === "user" ? "You" : "Agent"}: ${e.text}`)
    .join("\n\n")

  return {
    connectionState,
    error,
    transcript,
    storySetup,
    storyConfig,
    setupDone,
    connect,
    disconnect,
    sendTurn,
  }
}
