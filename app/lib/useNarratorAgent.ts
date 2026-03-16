import { useCallback, useEffect, useRef, useState } from "react"
import { useFetcher } from "react-router"
import {
  FunctionResponseScheduling,
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
import {
  buildNarratorSystemInstruction,
  MODEL,
  PREPARE_NEXT_PAGE_TOOL,
  SHOW_NEXT_PAGE_TOOL,
} from "~/lib/story-agent-config"
import {
  createHandleModelTurn,
  createHandleTurnNarrator,
  createWaitMessage,
} from "~/lib/live-turn-handlers"
import { createMicrophoneCapture } from "~/lib/microphone-capture"

export type { UseNarratorAgentReturn }

function pageFromStoryConfig(config: StoryConfig | null): PageContent {
  if (!config) return { shortPlot: "" }
  return {
    shortPlot: config.shortPlot,
    coverImageBase64: config.coverImageBase64,
    coverImageMimeType: config.coverImageMimeType,
  }
}

function extractCharacterName(entry: string): string {
  // Entries are expected to start with "Name: ..." or "Name - ..."
  return entry.split(/[:\-]/)[0].trim().toLowerCase()
}

function mergeCharacterUpdates(prev: string[], updates: string[]): string[] {
  const result = [...prev]
  for (const update of updates) {
    const updateName = extractCharacterName(update)
    const existingIndex = result.findIndex(
      (e) => extractCharacterName(e) === updateName,
    )
    if (existingIndex !== -1) {
      result[existingIndex] = update
    } else {
      result.push(update)
    }
  }
  return result
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
  const [isMicrophoneOn, setIsMicrophoneOn] = useState(false)

  const sessionRef = useRef<Session | null>(null)
  const microphoneCaptureRef = useRef<ReturnType<
    typeof createMicrophoneCapture
  > | null>(null)
  const currentPageRef = useRef(currentPage)
  currentPageRef.current = currentPage
  // Separate ref updated synchronously (not render-gated) for use in show_next_page handler
  const nextPageDataRef = useRef<PageContent | null>(null)
  const liveTranscriptRef = useRef<TranscriptEntry[]>([])
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
  const prepareNextPageAbortRef = useRef<AbortController | null>(null)
  const prepareNextPageInFlightRef = useRef(false)
  const prepareCompletedForCurrentPageRef = useRef(false)
  const modelTurnActiveRef = useRef(false)

  const fetcher = useFetcher<{ token?: string; error?: string }>()
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const disconnect = useCallback(() => {
    microphoneCaptureRef.current?.stop()
    microphoneCaptureRef.current = null
    setIsMicrophoneOn(false)
    sessionRef.current?.close()
    sessionRef.current = null
    handleTurnNarratorRef.current = null
    prepareNextPageAbortRef.current?.abort()
    prepareNextPageAbortRef.current = null
    prepareNextPageInFlightRef.current = false
    prepareCompletedForCurrentPageRef.current = false
    nextPageDataRef.current = null
    modelTurnActiveRef.current = false
    queueRef.current = []
    audioPartsRef.current = []
    liveTranscriptRef.current = []
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

    const onAudioChunk = () => {}

    const handleModelTurn = createHandleModelTurn({
      setTranscriptLines,
      liveTranscriptRef,
      audioPartsRef,
      mimeTypeRef,
      onAudioChunk,
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
          systemInstruction: buildNarratorSystemInstruction(
            storyConfig.shortPlot,
            storyConfig.characters ?? [],
          ),
          thinkingConfig: { thinkingBudget: 0 },
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: storyConfig.voiceName },
            },
          },
          outputAudioTranscription: {},
          inputAudioTranscription: {},
          contextWindowCompression: {
            triggerTokens: "104857",
            slidingWindow: { targetTokens: "52428" },
          },
          tools: [
            {
              functionDeclarations: [
                PREPARE_NEXT_PAGE_TOOL,
                SHOW_NEXT_PAGE_TOOL,
              ],
            },
          ],
        },
        callbacks: {
          onopen: async () => {
            if (!mountedRef.current) return
            setConnectionState("connected")
            // Auto-start mic on connect
            try {
              if (!microphoneCaptureRef.current) {
                microphoneCaptureRef.current = createMicrophoneCapture()
              }
              const sendChunk = (base64: string) => {
                sessionRef.current?.sendRealtimeInput({
                  audio: { data: base64, mimeType: "audio/pcm;rate=16000" },
                })
              }
              await microphoneCaptureRef.current.start(sendChunk)
              if (mountedRef.current) setIsMicrophoneOn(true)
            } catch (e) {
              if (mountedRef.current) {
                setError(
                  e instanceof Error ? e.message : "Microphone access failed",
                )
              }
            }
          },
          onmessage: (message: LiveServerMessage) => {
            queueRef.current.push(message)
            if (
              message.serverContent?.outputTranscription?.text &&
              !modelTurnActiveRef.current
            ) {
              modelTurnActiveRef.current = true
              // Proactive model turn started with no active turn loop — start one
              // so the queue doesn't accumulate stale turnComplete messages.
              if (!isHandlingTurnRef.current) {
                const handleTurnNarrator = handleTurnNarratorRef.current
                if (handleTurnNarrator) {
                  isHandlingTurnRef.current = true
                  handleTurnNarrator()
                    .finally(() => {
                      isHandlingTurnRef.current = false
                    })
                    .catch(() => {})
                }
              }
            }
            handleModelTurn(message)

            if (message.serverContent?.interrupted) {
              modelTurnActiveRef.current = false
            }

            if (message.serverContent?.turnComplete) {
              modelTurnActiveRef.current = false
            }

            // Handle tool calls from the narrator
            if (message.toolCall?.functionCalls?.length) {
              for (const fc of message.toolCall.functionCalls) {
                if (fc.name === "prepare_next_page" && fc.id) {
                  const callId = fc.id

                  // At most one real prepare per page: if already in flight or already completed for this page, short-circuit with a silent response.
                  if (
                    prepareNextPageInFlightRef.current ||
                    prepareCompletedForCurrentPageRef.current
                  ) {
                    sessionRef.current?.sendToolResponse({
                      functionResponses: [
                        {
                          id: callId,
                          name: "prepare_next_page",
                          response: {
                            result: "already_preparing",
                            scheduling: FunctionResponseScheduling.SILENT,
                          },
                        },
                      ],
                    })
                    continue
                  }

                  prepareNextPageInFlightRef.current = true
                  console.log(
                    "[prepare_next_page] Starting real server request for current page.",
                  )

                  const controller = new AbortController()
                  prepareNextPageAbortRef.current = controller
                  const pageToUse = currentPageRef.current
                  const transcriptForApi = liveTranscriptRef.current
                    .map(
                      (e) =>
                        `${e.role === "user" ? "You" : "Agent"}: ${e.text}`,
                    )
                    .join("\n\n")

                  fetch("/api/prepare-next-page", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    signal: controller.signal,
                    body: JSON.stringify({
                      transcript: transcriptForApi,
                      currentShortPlot: pageToUse.shortPlot,
                      characters: currentCharactersRef.current,
                      illustrationStyle: currentIllustrationStyleRef.current,
                      ...(pageToUse.coverImageBase64 &&
                        pageToUse.coverImageMimeType && {
                          currentPageImageBase64: pageToUse.coverImageBase64,
                          currentPageImageMimeType:
                            pageToUse.coverImageMimeType,
                        }),
                    }),
                  })
                    .then((res) =>
                      res.ok
                        ? res.json()
                        : res
                            .json()
                            .catch(() => ({}))
                            .then((data) =>
                              Promise.reject(
                                new Error(
                                  (data as { error?: string }).error ??
                                    "failed",
                                ),
                              ),
                            ),
                    )
                    .then((data) => {
                      // If this request was aborted (e.g. on disconnect) or unmounted, skip.
                      if (controller.signal.aborted || !mountedRef.current) {
                        return
                      }
                      const shortPlot =
                        typeof data.nextShortPlot === "string"
                          ? data.nextShortPlot
                          : ""
                      const hasImage =
                        typeof data.nextCoverImageBase64 === "string" &&
                        data.nextCoverImageBase64
                      const imageMissingFlag =
                        typeof data.imageMissing === "boolean"
                          ? data.imageMissing
                          : false

                      // Only treat as ready when we have a non-empty shortPlot.
                      if (shortPlot) {
                        prepareCompletedForCurrentPageRef.current = true
                        const nextPageContent: PageContent = {
                          shortPlot,
                          coverImageBase64:
                            typeof data.nextCoverImageBase64 === "string"
                              ? data.nextCoverImageBase64
                              : undefined,
                          coverImageMimeType:
                            typeof data.nextCoverImageMimeType === "string"
                              ? data.nextCoverImageMimeType
                              : undefined,
                        }
                        nextPageDataRef.current = nextPageContent
                        setNextPage(nextPageContent)
                        // Mark next page as ready even if the server had to fall
                        // back to JSON-only after retries. The imageMissing flag
                        // is for UI/telemetry; retries already tried to recover.
                        setNextPageReady(true)
                      }
                      const updates = Array.isArray(data.characterUpdates)
                        ? data.characterUpdates.filter(
                            (x: unknown): x is string => typeof x === "string",
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

                      // Always acknowledge the tool call with result: "ok".
                      sessionRef.current?.sendToolResponse({
                        functionResponses: [
                          {
                            id: callId,
                            name: "prepare_next_page",
                            response: {
                              result: "ok",
                              scheduling: FunctionResponseScheduling.WHEN_IDLE,
                            },
                          },
                        ],
                      })
                    })
                    .catch((err) => {
                      // Don't send responses if aborted (e.g. on disconnect) or unmounted.
                      if (controller.signal.aborted || !mountedRef.current)
                        return
                      console.error(
                        "prepare_next_page: failed to prepare next page",
                        err,
                      )
                    })
                    .finally(() => {
                      // Clear in-flight markers if this is still the active controller.
                      if (prepareNextPageAbortRef.current === controller) {
                        prepareNextPageInFlightRef.current = false
                        prepareNextPageAbortRef.current = null
                      }
                    })
                } else if (fc.name === "show_next_page" && fc.id) {
                  console.log("=============show next page====================")
                  const nextPageData = nextPageDataRef.current
                  if (nextPageData) {
                    console.log("Showing next page")
                    nextPageDataRef.current = null
                    // Update ref synchronously so the next prepare_next_page call
                    // sees the correct current page even before React re-renders.
                    currentPageRef.current = nextPageData
                    setCurrentPage(nextPageData)
                    setNextPage(null)
                    setNextPageReady(false)
                    // Reset prepare state so the next prepare_next_page call is for the new page.
                    prepareCompletedForCurrentPageRef.current = false
                    prepareNextPageInFlightRef.current = false
                  }
                  sessionRef.current?.sendToolResponse({
                    functionResponses: [
                      nextPageData
                        ? {
                            id: fc.id,
                            name: "show_next_page",
                            response: {
                              result: "ok",
                              scheduling: FunctionResponseScheduling.WHEN_IDLE,
                            },
                          }
                        : {
                            id: fc.id,
                            name: "show_next_page",
                            response: {
                              result: "no_page_ready",
                              scheduling: FunctionResponseScheduling.SILENT,
                            },
                          },
                    ],
                  })
                }
              }
            }
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
    session.sendRealtimeInput({ text })

    const handleTurnNarrator = handleTurnNarratorRef.current
    if (!handleTurnNarrator) return
    isHandlingTurnRef.current = true
    handleTurnNarrator()
      .finally(() => {
        isHandlingTurnRef.current = false
      })
      .catch(() => {})
  }, [])

  const startMicrophone = useCallback(async () => {
    const session = sessionRef.current
    if (!session) return
    try {
      if (!microphoneCaptureRef.current) {
        microphoneCaptureRef.current = createMicrophoneCapture()
      }
      const sendChunk = (base64: string) => {
        sessionRef.current?.sendRealtimeInput({
          audio: { data: base64, mimeType: "audio/pcm;rate=16000" },
        })
      }
      await microphoneCaptureRef.current.start(sendChunk)
      setIsMicrophoneOn(true)
    } catch (e) {
      if (mountedRef.current) {
        setError(e instanceof Error ? e.message : "Microphone access failed")
      }
    }
  }, [])

  const stopMicrophone = useCallback(() => {
    microphoneCaptureRef.current?.stop()
    microphoneCaptureRef.current = null
    setIsMicrophoneOn(false)
  }, [])

  const sendImage = useCallback((base64: string, mimeType?: string) => {
    const session = sessionRef.current
    if (!session) return
    session.sendRealtimeInput({
      video: { data: base64, mimeType: mimeType ?? "image/jpeg" },
    })
  }, [])

  const reportError = useCallback((message: string) => {
    setError(message)
  }, [])

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
    isMicrophoneOn,
    startMicrophone,
    stopMicrophone,
    sendImage,
    reportError,
  }
}
