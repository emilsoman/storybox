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
  PageContent,
  Session,
  StoryConfig,
  TranscriptEntry,
  UseNarratorAgentReturn,
} from "~/lib/gemini-live.types"
import {
  buildIllustrationStylePrefix,
  DEFAULT_GLOBAL_ILLUSTRATION_STYLE,
} from "~/lib/gemini-live.types"
import { buildNarratorSystemInstruction, MODEL } from "~/lib/story-agent-config"
import {
  createHandleModelTurn,
  createHandleTurnNarrator,
  createWaitMessage,
} from "~/lib/live-turn-handlers"

export type { UseNarratorAgentReturn }

function pageFromStoryConfig(config: StoryConfig | null): PageContent {
  if (!config) return { shortPlot: "" }
  return {
    shortPlot: config.shortPlot,
    coverImageBase64: config.coverImageBase64,
    coverImageMimeType: config.coverImageMimeType,
  }
}

function mergeCharacterUpdates(prev: string[], updates: string[]): string[] {
  return [...prev, ...updates]
}

export function useNarratorAgent(
  storyConfig: StoryConfig | null,
): UseNarratorAgentReturn {
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected")
  const [error, setError] = useState<string | null>(null)
  const [transcriptLines, setTranscriptLines] = useState<TranscriptEntry[]>([])
  const [currentPage, setCurrentPage] = useState<PageContent>(() =>
    pageFromStoryConfig(storyConfig),
  )
  const [nextPage, setNextPage] = useState<PageContent | null>(null)
  const [nextPageReady, setNextPageReady] = useState(false)
  const [currentCharacters, setCurrentCharacters] = useState<string[]>(
    () => storyConfig?.characters ?? [],
  )
  const [currentIllustrationStyle, setCurrentIllustrationStyle] = useState(
    () =>
      storyConfig?.illustrationStyle?.trim() ||
      DEFAULT_GLOBAL_ILLUSTRATION_STYLE,
  )

  const sessionRef = useRef<Session | null>(null)
  const currentPageRef = useRef(currentPage)
  currentPageRef.current = currentPage
  const currentCharactersRef = useRef(currentCharacters)
  currentCharactersRef.current = currentCharacters
  const currentIllustrationStyleRef = useRef(currentIllustrationStyle)
  currentIllustrationStyleRef.current = currentIllustrationStyle
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
    setNextPage(null)
    setNextPageReady(false)
    if (storyConfig) setCurrentPage(pageFromStoryConfig(storyConfig))
  }, [storyConfig])

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
    fetcherRef.current.submit(
      {},
      { method: "POST", action: "/api/gemini-token" },
    )
  }, [storyConfig])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (storyConfig && currentPage.shortPlot === "" && !nextPage) {
      setCurrentPage(pageFromStoryConfig(storyConfig))
    }
  }, [storyConfig, currentPage.shortPlot, nextPage])

  useEffect(() => {
    if (!storyConfig) return
    if (storyConfig.characters?.length && currentCharacters.length === 0) {
      setCurrentCharacters(storyConfig.characters)
    }
    if (
      storyConfig.illustrationStyle?.trim() &&
      currentIllustrationStyle === DEFAULT_GLOBAL_ILLUSTRATION_STYLE
    ) {
      setCurrentIllustrationStyle(storyConfig.illustrationStyle.trim())
    }
  }, [storyConfig, currentCharacters.length, currentIllustrationStyle])

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
          enableAffectiveDialog: false,
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

  const sendTurn = useCallback(
    (text: string) => {
      const session = sessionRef.current
      if (!session) return
      if (isHandlingTurnRef.current) return

      const pageToUse = nextPage ?? currentPageRef.current
      if (nextPage) {
        setCurrentPage(nextPage)
        setNextPage(null)
        setNextPageReady(false)
      }

      const textToSend =
        pageToUse.shortPlot.trim() !== ""
          ? `Current page: ${pageToUse.shortPlot}\n\n${text}`
          : text
      setTranscriptLines((prev) => [...prev, { role: "user", text }])
      session.sendRealtimeInput({ text: textToSend })

      const transcriptForApi = [
        ...transcriptLines,
        { role: "user" as const, text },
      ]
        .map((e) => `${e.role === "user" ? "You" : "Agent"}: ${e.text}`)
        .join("\n\n")
      fetch("/api/prepare-next-page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: transcriptForApi,
          currentShortPlot: pageToUse.shortPlot,
          characters: currentCharactersRef.current,
          illustrationStyle: currentIllustrationStyleRef.current,
          ...(pageToUse.coverImageBase64 &&
            pageToUse.coverImageMimeType && {
              currentPageImageBase64: pageToUse.coverImageBase64,
              currentPageImageMimeType: pageToUse.coverImageMimeType,
            }),
        }),
      })
        .then((res) =>
          res.ok
            ? res.json()
            : Promise.reject(new Error("Prepare next page failed")),
        )
        .then(
          (data: {
            nextShortPlot?: string
            nextCoverImageBase64?: string
            nextCoverImageMimeType?: string
            characterUpdates?: string[]
          }) => {
            if (!mountedRef.current) return
            const shortPlot =
              typeof data.nextShortPlot === "string" ? data.nextShortPlot : ""
            if (shortPlot) {
              setNextPage({
                shortPlot,
                coverImageBase64:
                  typeof data.nextCoverImageBase64 === "string"
                    ? data.nextCoverImageBase64
                    : undefined,
                coverImageMimeType:
                  typeof data.nextCoverImageMimeType === "string"
                    ? data.nextCoverImageMimeType
                    : undefined,
              })
              setNextPageReady(true)
            }
            const updates = Array.isArray(data.characterUpdates)
              ? data.characterUpdates.filter(
                  (x): x is string => typeof x === "string",
                )
              : []
            if (updates.length > 0) {
              const merged = mergeCharacterUpdates(
                currentCharactersRef.current,
                updates,
              )
              const newStyle = buildIllustrationStylePrefix(
                merged,
                currentIllustrationStyleRef.current ||
                  DEFAULT_GLOBAL_ILLUSTRATION_STYLE,
              )
              setCurrentCharacters(merged)
              setCurrentIllustrationStyle(newStyle)
            }
          },
        )
        .catch(() => {})

      const handleTurnNarrator = handleTurnNarratorRef.current
      if (!handleTurnNarrator) return
      isHandlingTurnRef.current = true
      handleTurnNarrator()
        .finally(() => {
          isHandlingTurnRef.current = false
        })
        .catch(() => {})
    },
    [nextPage, transcriptLines],
  )

  const transcript = transcriptLines
    .map((e) => `${e.role === "user" ? "You" : "Agent"}: ${e.text}`)
    .join("\n\n")

  return {
    connectionState,
    error,
    transcript,
    transcriptLines,
    currentPage,
    nextPage,
    nextPageReady,
    currentCharacters,
    currentIllustrationStyle,
    connect,
    disconnect,
    sendTurn,
  }
}
