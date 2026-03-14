import { GoogleGenAI } from "@google/genai/web"

export type ConnectionState = "disconnected" | "connecting" | "connected"

export type StoryConfig = {
  shortPlot: string
  lucideIconNames: string[]
  voiceName: string
  /** Base64-encoded cover image from prepare-story (e.g. PNG). */
  coverImageBase64?: string
  coverImageMimeType?: string
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
  connect: () => void
  disconnect: () => void
  sendTurn: (text: string) => void
}

export type Session = Awaited<
  ReturnType<InstanceType<typeof GoogleGenAI>["live"]["connect"]>
>

export type TranscriptEntry = { role: "user" | "agent"; text: string }
