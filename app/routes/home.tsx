import type { Route } from "./+types/home"
import { VoiceChat } from "~/components/VoiceChat"

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Live Storybook – Set up your story" },
    {
      name: "description",
      content:
        "Set up your story with the Gemini agent. Tell us about the characters and what happens.",
    },
  ]
}

export default function Home() {
  return <VoiceChat />
}
