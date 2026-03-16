import { GoogleGenAI } from "@google/genai/web"

export type ConnectionState = "disconnected" | "connecting" | "connected"

export type StoryConfig = {
  shortPlot: string
  voiceName: string
  /** Base64-encoded cover image from prepare-story (e.g. PNG). */
  coverImageBase64?: string
  coverImageMimeType?: string
  /** Character descriptions for consistent image generation (one string per character). */
  characters?: string[]
  /** Prefix for image prompts: global style + character descriptions (no scene). */
  illustrationStyle?: string
}

export type PageContent = {
  shortPlot: string
  coverImageBase64?: string
  coverImageMimeType?: string
}

export type UseStorySetupAgentReturn = {
  connectionState: ConnectionState
  error: string | null
  transcript: string
  /** Full transcript as entries; filter to role === "agent" for agent-only. */
  transcriptLines: TranscriptEntry[]
  storySetup: string | null
  storyConfig: StoryConfig | null
  /** True only after the setup agent has finished speaking following the start_story tool result. */
  setupDone: boolean
  connect: () => void
  disconnect: () => void
  sendTurn: (text: string) => void
  isMicrophoneOn: boolean
  startMicrophone: () => Promise<void>
  stopMicrophone: () => void
  sendImage: (base64: string, mimeType?: string) => void
  /** Report an error message (e.g. camera permission) to show in the existing error state. */
  reportError: (message: string) => void
}

export type UseNarratorAgentReturn = {
  connectionState: ConnectionState
  error: string | null
  transcript: string
  /** Full transcript as entries; filter to role === "agent" for narrator-only. */
  transcriptLines: TranscriptEntry[]
  currentPage: PageContent
  /** When next page is prepared, its content; null otherwise. */
  nextPage: PageContent | null
  nextPageReady: boolean
  /** Live character list (updated as story progresses). */
  currentCharacters: string[]
  /** Live illustration style prefix (updated as story progresses). */
  currentIllustrationStyle: string
  connect: () => void
  disconnect: () => void
  sendTurn: (text: string) => void
  isMicrophoneOn: boolean
  startMicrophone: () => Promise<void>
  stopMicrophone: () => void
  sendImage: (base64: string, mimeType?: string) => void
  /** Report an error message (e.g. camera permission) to show in the existing error state. */
  reportError: (message: string) => void
}

export type Session = Awaited<
  ReturnType<InstanceType<typeof GoogleGenAI>["live"]["connect"]>
>

export type TranscriptEntry = { role: "user" | "agent"; text: string }

/** Default global style for illustration prompts. */
export const DEFAULT_GLOBAL_ILLUSTRATION_STYLE =
  "Soft watercolor illustration for a children's book, gentle pastel colors, simple whimsical characters and scenery, hand-painted texture, light brush strokes, storybook style, lots of negative space, edges softly fading and dissolving into a pure white background, dreamy and warm, minimal outlines, high-quality watercolor paper texture, calm and friendly mood."

/**
 * Builds the illustration style prefix: base style + character descriptions (no scene).
 * Stored as illustrationStyle and prepended to scene in image prompts.
 */
export function buildIllustrationStylePrefix(
  characterDescriptions: string[],
  baseStyle: string = DEFAULT_GLOBAL_ILLUSTRATION_STYLE,
): string {
  const stylePart = baseStyle.trim()
  const trimmed = characterDescriptions
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean)
  if (trimmed.length === 0) return stylePart
  return [stylePart, trimmed.join(", ")].filter(Boolean).join(", ")
}

/**
 * Builds the full image prompt: illustrationStyle prefix + scene.
 * Used for cover and next-page image generation so characters stay consistent.
 */
export function buildIllustrationPrompt(
  illustrationStylePrefix: string,
  sceneDescription: string,
): string {
  const prefix = illustrationStylePrefix.trim()
  const scene = sceneDescription.trim()
  if (!scene) return prefix
  return `${prefix}, ${scene}`
}
