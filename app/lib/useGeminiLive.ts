import { useCallback, useEffect, useRef, useState } from "react"
import { useFetcher } from "react-router"
import {
  GoogleGenAI,
  type LiveServerMessage,
  Modality,
} from "@google/genai/web"
import {
  clearPlaybackBuffer,
  initializeAudio,
  playPcmBase64Chunk,
  stopPlayback,
} from "~/lib/audio-utils"

const MODEL = "gemini-2.5-flash-native-audio-preview-12-2025"

const STORY_SETUP_SYSTEM_INSTRUCTION = `
You are a friendly story co-creator helping someone set up a kids' storybook.
Your job is to collect a story setup: who the characters are, where
the story takes place, the tone (e.g. funny, gentle, adventurous), and any plot
ideas they have.

Keep your replies short and conversational so they work well when spoken aloud.

When starting, greet the user and ask them for the story setup unless one is provided already.
Be warm and friendly, but concise.
You don't need to ask follow ups.
`

export type ConnectionState = "disconnected" | "connecting" | "connected"

export type UseGeminiLiveReturn = {
  connectionState: ConnectionState
  error: string | null
  transcript: string
  storySetup: string | null
  connect: () => void
  disconnect: () => void
  sendTurn: (text: string) => void
}

type Session = Awaited<
  ReturnType<InstanceType<typeof GoogleGenAI>["live"]["connect"]>
>

type TranscriptEntry = { role: "user" | "agent"; text: string }

export function useGeminiLive(): UseGeminiLiveReturn {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected")
  const [error, setError] = useState<string | null>(null)
  const [transcriptLines, setTranscriptLines] = useState<TranscriptEntry[]>([])
  const [storySetup, setStorySetup] = useState<string | null>(null)

  const sessionRef = useRef<Session | null>(null)
  const storySetupAbortRef = useRef<AbortController | null>(null)
  const queueRef = useRef<LiveServerMessage[]>([])
  const audioPartsRef = useRef<string[]>([])
  const mimeTypeRef = useRef<string>("audio/pcm;rate=24000")
  const handleTurnRef = useRef<(() => Promise<void>) | null>(null)
  const isHandlingTurnRef = useRef(false)
  const pendingConnectRef = useRef(false)

  const fetcher = useFetcher<{ token?: string; error?: string }>()

  const disconnect = useCallback(() => {
    sessionRef.current?.close()
    sessionRef.current = null
    handleTurnRef.current = null
    queueRef.current = []
    audioPartsRef.current = []
    storySetupAbortRef.current?.abort()
    storySetupAbortRef.current = null
    stopPlayback()
    setConnectionState("disconnected")
    setError(null)
    setTranscriptLines([])
    setStorySetup(null)
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

    function handleModelTurn(message: LiveServerMessage): void {
      const content = message.serverContent
      if (!content) return

      if (content.interrupted) {
        clearPlaybackBuffer()
        audioPartsRef.current = []
      }

      // Use outputTranscription (what was actually spoken), not modelTurn.parts text (includes thinking)
      // Append to the same agent line so the UI updates in place instead of one line per chunk
      if (content.outputTranscription?.text) {
        const chunk = content.outputTranscription.text
        setTranscriptLines((prev) => {
          const last = prev[prev.length - 1]
          if (last?.role === "agent") {
            return [
              ...prev.slice(0, -1),
              { role: "agent", text: last.text + chunk },
            ]
          }
          return [...prev, { role: "agent", text: chunk }]
        })
      }

      // Official pattern: play each audio chunk as it arrives via worklet queue (in order, continuous). See gemini-live-api-examples frontend.
      const parts = content.modelTurn?.parts
      if (parts) {
        const part = parts[0]
        if (part?.fileData) {
          // reference only logs
        } else if (part?.inlineData) {
          const data = part.inlineData?.data ?? ""
          if (data) {
            playPcmBase64Chunk(data).catch(() => {})
          }
          if (part.inlineData?.mimeType) {
            mimeTypeRef.current = part.inlineData.mimeType
          }
        }
      }

      if (content.turnComplete) {
        audioPartsRef.current = []
      }
    }

    function waitMessage(): Promise<LiveServerMessage> {
      return new Promise((resolve) => {
        const check = () => {
          const message = queueRef.current.shift()
          if (message) {
            handleModelTurn(message)
            resolve(message)
            return
          }
          setTimeout(check, 100)
        }
        check()
      })
    }

    async function handleTurn(): Promise<void> {
      let done = false
      while (!done) {
        const message = await waitMessage()
        if (message.serverContent?.turnComplete) {
          done = true
        }
      }
    }
    handleTurnRef.current = handleTurn

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
            disconnect()
          },
        },
      })
      .then((session) => {
        sessionRef.current = session
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
      session.sendClientContent({ turns: [text] })

      // Non-blocking: update story setup from transcript (including this turn)
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

      const handleTurn = handleTurnRef.current
      if (!handleTurn) return
      isHandlingTurnRef.current = true
      handleTurn()
        .finally(() => {
          isHandlingTurnRef.current = false
        })
        .catch(() => {})
    },
    [transcriptLines],
  )

  const transcript = transcriptLines
    .map((e) => `${e.role === "user" ? "You" : "Agent"}: ${e.text}`)
    .join("\n\n")

  return {
    connectionState,
    error,
    transcript,
    storySetup,
    connect,
    disconnect,
    sendTurn,
  }
}
