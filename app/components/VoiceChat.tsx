import { useStorySetupAgent } from "~/lib/useStorySetupAgent"
import { useNarratorAgent } from "~/lib/useNarratorAgent"
import { StorySetupView } from "~/components/StorySetupView"
import { NarratorView } from "~/components/NarratorView"

export function VoiceChat() {
  const setup = useStorySetupAgent()
  const narrator = useNarratorAgent(setup.storyConfig)

  return (
    <main className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      {setup.storyConfig == null || !setup.setupDone ? (
        <StorySetupView {...setup} />
      ) : (
        <NarratorView storyConfig={setup.storyConfig} {...narrator} />
      )}
    </main>
  )
}
