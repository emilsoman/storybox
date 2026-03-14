import { GoogleGenAI } from "@google/genai/web"

export type ConnectionState = "disconnected" | "connecting" | "connected"

export type StoryConfig = {
  shortPlot: string
  lucideIconNames: string[]
  voiceName: string
}

export type UseGeminiLiveReturn = {
  connectionState: ConnectionState
  error: string | null
  transcript: string
  storySetup: string | null
  storyStarted: boolean
  storyConfig: StoryConfig | null
  connect: () => void
  disconnect: () => void
  sendTurn: (text: string) => void
}

export type Session = Awaited<
  ReturnType<InstanceType<typeof GoogleGenAI>["live"]["connect"]>
>

export type TranscriptEntry = { role: "user" | "agent"; text: string }
