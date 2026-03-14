import { useState } from "react"
import ReactMarkdown from "react-markdown"
import * as LucideIcons from "lucide-react"
import { Phone, PhoneOff, Send } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Button } from "~/components/ui/button"
import { useGeminiLive, type StoryConfig } from "~/lib/useGeminiLive"

function StoryPreparedSection({ config }: { config: StoryConfig }) {
  const iconMap = LucideIcons as unknown as Record<
    string,
    LucideIcon | undefined
  >
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Prepared story
      </p>
      {config.shortPlot && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Plot</p>
          <p className="text-sm">{config.shortPlot}</p>
        </div>
      )}
      {config.lucideIconNames.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          <p className="text-xs font-medium text-muted-foreground w-full mb-1">
            Icons
          </p>
          {config.lucideIconNames.map((name) => {
            const Icon = iconMap[name]
            if (!Icon) return null
            return (
              <span
                key={name}
                className="inline-flex items-center justify-center rounded-md border border-border bg-background p-2"
                title={name}
              >
                <Icon className="size-5" />
              </span>
            )
          })}
        </div>
      )}
      <p className="text-sm">
        <span className="text-muted-foreground">Narrator voice: </span>
        <strong>{config.voiceName}</strong>
      </p>
    </div>
  )
}

export function VoiceChat() {
  const [inputText, setInputText] = useState("")
  const {
    connectionState,
    error,
    transcript,
    storySetup,
    storyStarted,
    storyConfig,
    connect,
    disconnect,
    sendTurn,
  } = useGeminiLive()

  const handleConnect = () => {
    if (connectionState === "connected") {
      disconnect()
    } else {
      connect()
    }
  }

  const handleSend = () => {
    const text = inputText.trim()
    if (!text) return
    sendTurn(text)
    setInputText("")
  }

  return (
    <main className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg space-y-8">
        <header className="text-center space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Set up your story
          </h1>
          <p className="text-muted-foreground text-sm">
            Tell me about the characters and what happens in your story.
          </p>
        </header>

        {error && (
          <div
            className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            role="alert"
          >
            {error}
          </div>
        )}

        <div className="flex flex-col items-center gap-4">
          <Button
            size="lg"
            onClick={handleConnect}
            disabled={connectionState === "connecting"}
            className="min-w-[200px]"
          >
            {connectionState === "connecting" ? (
              "Connecting…"
            ) : connectionState === "connected" ? (
              <>
                <PhoneOff className="mr-2 size-5" />
                End call
              </>
            ) : (
              <>
                <Phone className="mr-2 size-5" />
                Start story setup
              </>
            )}
          </Button>

          {connectionState === "connected" && (
            <div className="w-full flex gap-2">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder="Type your message…"
                className="flex-1 min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={handleSend}
                disabled={!inputText.trim()}
                aria-label="Send"
              >
                <Send className="size-5" />
              </Button>
            </div>
          )}
        </div>

        {storyStarted && (
          <div className="rounded-lg border border-green-500/50 bg-green-500/10 px-4 py-3 text-sm text-green-700 dark:text-green-400">
            Story started!
          </div>
        )}

        {storyConfig && <StoryPreparedSection config={storyConfig} />}

        {storySetup != null && storySetup !== "" && (
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Story setup
            </p>
            <div className="text-sm [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_h2]:font-semibold [&_h2]:mt-2 [&_p]:mb-1">
              <ReactMarkdown>{storySetup}</ReactMarkdown>
            </div>
          </div>
        )}

        {transcript && (
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              Transcript
            </p>
            <p className="text-sm whitespace-pre-wrap">{transcript}</p>
          </div>
        )}
      </div>
    </main>
  )
}
