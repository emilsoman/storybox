import { useEffect, useRef, useState } from "react"
import * as LucideIcons from "lucide-react"
import { Phone, PhoneOff, Send } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Button } from "~/components/ui/button"
import type {
  PageContent,
  StoryConfig,
  UseNarratorAgentReturn,
} from "~/lib/gemini-live.types"

function CurrentPageSection({
  currentPage,
  storyConfig,
  nextPageReady,
}: {
  currentPage: PageContent
  storyConfig: StoryConfig
  nextPageReady: boolean
}) {
  const iconMap = LucideIcons as unknown as Record<
    string,
    LucideIcon | undefined
  >
  const coverImageDataUrl =
    currentPage.coverImageBase64 && currentPage.coverImageMimeType
      ? `data:${currentPage.coverImageMimeType};base64,${currentPage.coverImageBase64}`
      : null
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Current page
        </p>
        {nextPageReady && (
          <span className="text-xs font-medium text-primary shrink-0">
            Next page ready
          </span>
        )}
      </div>
      {coverImageDataUrl && (
        <div className="rounded-md overflow-hidden border border-border bg-muted/50">
          <img
            src={coverImageDataUrl}
            alt="Story page"
            className="w-full aspect-[4/3] object-cover"
          />
        </div>
      )}
      {currentPage.shortPlot && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">Plot</p>
          <p className="text-sm">{currentPage.shortPlot}</p>
        </div>
      )}
      {storyConfig.lucideIconNames.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          <p className="text-xs font-medium text-muted-foreground w-full mb-1">
            Icons
          </p>
          {storyConfig.lucideIconNames.map((name) => {
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
        <strong>{storyConfig.voiceName}</strong>
      </p>
    </div>
  )
}

function CharacterAndStyleSection({
  characters,
  illustrationStyle,
}: {
  characters: string[]
  illustrationStyle: string
}) {
  if (characters.length === 0 && !illustrationStyle.trim()) return null
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Characters & illustration style
      </p>
      {characters.length > 0 && (
        <div className="space-y-3">
          {characters.map((desc, i) => (
            <div
              key={i}
              className="rounded-md border border-border bg-background/80 p-3 text-sm text-muted-foreground"
            >
              {desc}
            </div>
          ))}
        </div>
      )}
      {illustrationStyle.trim() && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">
            Illustration style (used for images)
          </p>
          <p className="text-sm text-muted-foreground break-words whitespace-pre-wrap rounded-md border border-border bg-muted/50 p-2 max-h-24 overflow-y-auto">
            {illustrationStyle}
          </p>
        </div>
      )}
    </div>
  )
}

export function NarratorView({
  storyConfig,
  connectionState,
  error,
  transcript,
  currentPage,
  nextPageReady,
  currentCharacters,
  currentIllustrationStyle,
  connect,
  disconnect,
  sendTurn,
}: { storyConfig: StoryConfig } & UseNarratorAgentReturn) {
  const [inputText, setInputText] = useState("")
  const connectRef = useRef(connect)
  connectRef.current = connect

  useEffect(() => {
    connectRef.current()
  }, [])

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
    <div className="w-full max-w-lg space-y-8">
      <header className="text-center space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Story started!
        </h1>
        <p className="text-muted-foreground text-sm">
          Talk to the narrator. The story is ready.
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

      <CurrentPageSection
        currentPage={currentPage}
        storyConfig={storyConfig}
        nextPageReady={nextPageReady}
      />

      <CharacterAndStyleSection
        characters={
          currentCharacters.length > 0
            ? currentCharacters
            : (storyConfig.characters ?? [])
        }
        illustrationStyle={
          currentIllustrationStyle.trim()
            ? currentIllustrationStyle
            : (storyConfig.illustrationStyle ?? "")
        }
      />

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
              Start narrator
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

      {transcript && (
        <div className="rounded-lg border border-border bg-muted/30 p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Transcript
          </p>
          <p className="text-sm whitespace-pre-wrap">{transcript}</p>
        </div>
      )}
    </div>
  )
}
