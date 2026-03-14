import { GoogleGenAI } from "@google/genai/web"

export type ConnectionState = "disconnected" | "connecting" | "connected"

export type CharacterDetails = {
  name: string
  age?: string
  hair?: string
  eyes?: string
  clothing?: string
  style?: string
}

export type StoryConfig = {
  shortPlot: string
  lucideIconNames: string[]
  voiceName: string
  /** Base64-encoded cover image from prepare-story (e.g. PNG). */
  coverImageBase64?: string
  coverImageMimeType?: string
  /** Character descriptions for consistent image generation. */
  characters?: CharacterDetails[]
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
  storySetup: string | null
  storyConfig: StoryConfig | null
  /** True only after the setup agent has finished speaking following the start_story tool result. */
  setupDone: boolean
  connect: () => void
  disconnect: () => void
  sendTurn: (text: string) => void
}

export type UseNarratorAgentReturn = {
  connectionState: ConnectionState
  error: string | null
  transcript: string
  currentPage: PageContent
  nextPageReady: boolean
  /** Live character list (updated as story progresses). */
  currentCharacters: CharacterDetails[]
  /** Live illustration style prefix (updated as story progresses). */
  currentIllustrationStyle: string
  connect: () => void
  disconnect: () => void
  sendTurn: (text: string) => void
}

export type Session = Awaited<
  ReturnType<InstanceType<typeof GoogleGenAI>["live"]["connect"]>
>

export type TranscriptEntry = { role: "user" | "agent"; text: string }

/** Default global style for illustration prompts. */
export const DEFAULT_GLOBAL_ILLUSTRATION_STYLE =
  "children's book illustration, soft watercolor style"

/**
 * Builds the illustration style prefix: global style + character descriptions (no scene).
 * Stored as illustrationStyle and prepended to scene in image prompts.
 */
export function buildIllustrationStylePrefix(
  characters: CharacterDetails[],
  globalStyle: string = DEFAULT_GLOBAL_ILLUSTRATION_STYLE,
): string {
  const stylePart = globalStyle.trim()
  const characterParts = characters
    .filter((c) => c.name?.trim())
    .map((c) => {
      const desc: string[] = []
      if (c.age) desc.push(`${c.age} year old`)
      if (c.hair) desc.push(c.hair)
      if (c.eyes) desc.push(c.eyes)
      if (c.clothing) desc.push(c.clothing)
      if (c.style) desc.push(c.style)
      const rest = desc.join(", ").replace(/\s+/g, " ").trim()
      return rest ? `${c.name}: ${rest}` : c.name
    })
    .filter(Boolean)
  if (characterParts.length === 0) return stylePart
  return [stylePart, characterParts.join(", ")].filter(Boolean).join(", ")
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
