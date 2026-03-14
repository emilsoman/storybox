import { useCallback, useEffect, useRef, useState } from "react"
import { useFetcher } from "react-router"
import { GoogleGenAI, Modality } from "@google/genai/web"
import {
  captureMic16k,
  clearPlaybackBuffer,
  playPcm24kBase64,
  stopPlayback,
} from "~/lib/audio-utils"

const MODEL = "gemini-2.5-flash"

const STORY_SETUP_SYSTEM_INSTRUCTION = `You are a friendly story co-creator helping someone set up a kids' storybook. Your job is to collect a clear "story thread": who the characters are, where the story takes place, the tone (e.g. funny, gentle, adventurous), and any plot ideas they have.

Keep your replies short and conversational so they work well when spoken aloud. Ask one or two questions at a time. Start by greeting them and asking about the main character or the kind of story they want. If they share a lot at once, acknowledge it and ask a follow-up to fill in missing pieces (setting, other characters, tone). When they seem done or say they're finished, briefly summarize the story thread so we have a clear picture for the next step.`

export type ConnectionState = "disconnected" | "connecting" | "connected"

export type UseGeminiLiveReturn = {
  connectionState: ConnectionState
  error: string | null
  transcript: string
  connect: () => void
  disconnect: () => void
  startMute: () => void
  stopMute: () => void
  isMuted: boolean
}

export function useGeminiLive(): UseGeminiLiveReturn {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected")
  const [error, setError] = useState<string | null>(null)
  const [transcript, setTranscript] = useState("")
  const [isMuted, setIsMuted] = useState(false)

  const sessionRef = useRef<Awaited<
    ReturnType<InstanceType<typeof GoogleGenAI>["live"]["connect"]>
  > | null>(null)
  const micCaptureRef = useRef<Awaited<
    ReturnType<typeof captureMic16k>
  > | null>(null)
  const isMutedRef = useRef(false)
  const pendingConnectRef = useRef(false)
  isMutedRef.current = isMuted

  const fetcher = useFetcher<{ token?: string; error?: string }>()

  const disconnect = useCallback(() => {
    micCaptureRef.current?.stop()
    micCaptureRef.current = null
    sessionRef.current = null
    stopPlayback()
    setConnectionState("disconnected")
    setError(null)
    setTranscript("")
  }, [])

  const connect = useCallback(() => {
    setError(null)
    setConnectionState("connecting")
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

    // Ephemeral tokens require v1alpha; SDK defaults to v1beta (see Live API ephemeral token docs)
    const ai = new GoogleGenAI({
      apiKey: token,
      httpOptions: { apiVersion: "v1alpha" as const },
    })
    ai.live
      .connect({
        model: MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: STORY_SETUP_SYSTEM_INSTRUCTION,
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: "Puck" },
            },
          },
          // Long sessions: audio tokens accumulate ~25/sec; compression keeps context bounded
          contextWindowCompression: { slidingWindow: {} },
        },
        callbacks: {
          onopen: () => {
            setConnectionState("connected")
          },
          onmessage: (message: {
            serverContent?: {
              interrupted?: boolean
              modelTurn?: {
                parts?: Array<{
                  text?: string
                  inlineData?: { data?: string }
                }>
              }
            }
          }) => {
            const content = message.serverContent
            if (!content) return
            // User spoke while model was replying: discard playback buffer immediately
            if (content.interrupted) {
              clearPlaybackBuffer()
            }
            const parts = content.modelTurn?.parts ?? []
            for (const part of parts) {
              if (part.text) {
                setTranscript((prev) => prev + part.text)
              }
              if (part.inlineData?.data) {
                playPcm24kBase64(part.inlineData.data)
              }
            }
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
        return captureMic16k((base64Pcm) => {
          if (sessionRef.current && !isMutedRef.current) {
            sessionRef.current.sendRealtimeInput({
              audio: {
                data: base64Pcm,
                mimeType: "audio/pcm;rate=16000",
              },
            })
          }
        })
      })
      .then((capture) => {
        micCaptureRef.current = capture
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : "Failed to connect"
        setError(message)
        setConnectionState("disconnected")
      })
  }, [connectionState, fetcher.state, fetcher.data, disconnect])

  const startMute = useCallback(() => setIsMuted(true), [])
  const stopMute = useCallback(() => setIsMuted(false), [])

  return {
    connectionState,
    error,
    transcript,
    connect,
    disconnect,
    startMute,
    stopMute,
    isMuted,
  }
}
