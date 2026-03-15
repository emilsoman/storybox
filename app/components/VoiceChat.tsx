import { useEffect, useRef } from "react"
import { useStorySetupAgent } from "~/lib/useStorySetupAgent"
import { useNarratorAgent } from "~/lib/useNarratorAgent"
import { StorySetupView } from "~/components/StorySetupView"
import {
  NarratorLeftPanel,
  NarratorRightPanel,
} from "~/components/NarratorView"
import type { TranscriptEntry } from "~/lib/gemini-live.types"
import { cn } from "~/lib/utils"

const LEFT_PANEL_WRAPPER_CLASS =
  "flex flex-col min-h-0 w-full md:w-80 md:min-w-[280px] md:max-w-[360px] shrink-0 border border-border bg-muted/20 rounded-lg overflow-hidden"
const LEFT_PANEL_CONTENT_CLASS = "flex-1 min-h-0 overflow-y-auto p-4"
const TRANSCRIPT_SECTION_CLASS = "bg-muted/30 p-3 flex flex-col mt-4"
const RIGHT_PANEL_CLASS = "flex-1 min-w-0 flex flex-col overflow-hidden"

function TranscriptSection({
  transcriptLines,
}: {
  transcriptLines: TranscriptEntry[]
}) {
  const agentLines = transcriptLines.filter((e) => e.role === "agent")
  const latestAgent = agentLines[agentLines.length - 1]

  if (!latestAgent?.text?.trim()) return null

  return (
    <div
      className={TRANSCRIPT_SECTION_CLASS}
      role="log"
      aria-label="Transcript"
    >
      <p
        key={`latest-${agentLines.length}`}
        className={cn(
          "text-sm whitespace-pre-wrap text-muted-foreground",
          "animate-in fade-in duration-200",
        )}
      >
        {latestAgent.text}
      </p>
    </div>
  )
}

export function VoiceChat() {
  const setup = useStorySetupAgent()
  const narrator = useNarratorAgent(setup.storyConfig)
  const isNarrator = setup.storyConfig != null && setup.setupDone
  const didAutoConnectRef = useRef(false)

  useEffect(() => {
    if (isNarrator) {
      if (!didAutoConnectRef.current) {
        didAutoConnectRef.current = true
        narrator.connect()
      }
    } else {
      didAutoConnectRef.current = false
    }
  }, [isNarrator, narrator.connect])

  return (
    <main className="min-h-screen h-screen bg-background flex flex-col overflow-hidden p-0">
      <div className="w-full h-full flex flex-col md:flex-row min-h-0 gap-4 md:gap-6 p-4 md:p-6 overflow-hidden">
        <aside className={LEFT_PANEL_WRAPPER_CLASS}>
          <div className={LEFT_PANEL_CONTENT_CLASS}>
            {isNarrator ? (
              <>
                <NarratorLeftPanel
                  storyConfig={setup.storyConfig!}
                  storySetup={setup.storySetup}
                  {...narrator}
                />
                <TranscriptSection transcriptLines={narrator.transcriptLines} />
              </>
            ) : (
              <StorySetupView {...setup} />
            )}
          </div>
        </aside>
        <section className={RIGHT_PANEL_CLASS} aria-label="Content">
          {isNarrator ? (
            <NarratorRightPanel
              storyConfig={setup.storyConfig!}
              storySetup={setup.storySetup}
              {...narrator}
            />
          ) : null}
        </section>
      </div>
    </main>
  )
}
