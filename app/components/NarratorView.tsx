import { useState } from "react"
import {
  ChevronDown,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Send,
  Camera,
} from "lucide-react"
import { Button } from "~/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "~/components/ui/collapsible"
import { cn } from "~/lib/utils"
import type {
  StoryConfig,
  UseNarratorAgentReturn,
} from "~/lib/gemini-live.types"
import { useCameraCapture } from "~/lib/useCameraCapture"

function CollapsibleSection({
  label,
  defaultOpen = false,
  children,
}: {
  label: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  return (
    <Collapsible
      defaultOpen={defaultOpen}
      className="rounded-md border border-border bg-muted/20"
    >
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="group w-full justify-between rounded-md px-3 py-2 text-left font-medium hover:bg-muted/50"
        >
          <span>{label}</span>
          <ChevronDown className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-3 pb-3 pt-0 text-sm">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export type NarratorViewProps = {
  storyConfig: StoryConfig
  storySetup?: string | null
} & UseNarratorAgentReturn

export function NarratorLeftPanel({
  storyConfig,
  connectionState,
  error,
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
  storySetup = null,
}: NarratorViewProps) {
  const [inputText, setInputText] = useState("")
  const { openCamera, cameraModal } = useCameraCapture((base64, mimeType) => {
    try {
      sendImage(base64, mimeType)
    } catch (e) {
      reportError(e instanceof Error ? e.message : "Camera access failed")
    }
  })

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

  const handleMicToggle = () => {
    if (isMicrophoneOn) {
      stopMicrophone()
    } else {
      startMicrophone()
    }
  }

  const characters =
    currentCharacters.length > 0
      ? currentCharacters
      : (storyConfig.characters ?? [])
  const illustrationStyle = currentIllustrationStyle.trim()
    ? currentIllustrationStyle
    : (storyConfig.illustrationStyle ?? "")

  const isFirstPage = currentPage.shortPlot === storyConfig.shortPlot
  const plotToShow = isFirstPage
    ? storyConfig.shortPlot
    : nextPageReady && nextPage?.shortPlot
      ? nextPage.shortPlot
      : currentPage.shortPlot

  return (
    <>
      {cameraModal}
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        Story controls
      </h2>

      {error && (
        <div
          className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive mb-4"
          role="alert"
        >
          {error}
        </div>
      )}

      <div className="flex flex-col items-stretch gap-4 mb-4">
        <Button
          size="lg"
          onClick={handleConnect}
          disabled={connectionState === "connecting"}
          className="w-full"
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
          <>
            <div className="flex gap-2 items-center">
              <Button
                type="button"
                variant={isMicrophoneOn ? "default" : "secondary"}
                size="icon"
                onClick={handleMicToggle}
                aria-label={
                  isMicrophoneOn ? "Turn microphone off" : "Turn microphone on"
                }
                title={isMicrophoneOn ? "Microphone on" : "Microphone off"}
              >
                {isMicrophoneOn ? (
                  <Mic className="size-5" />
                ) : (
                  <MicOff className="size-5" />
                )}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={openCamera}
                aria-label="Take picture"
                title="Take picture"
              >
                <Camera className="size-5" />
              </Button>
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
          </>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <CollapsibleSection label="Characters" defaultOpen={false}>
          {characters.length === 0 ? (
            <p className="text-muted-foreground">No characters defined.</p>
          ) : (
            <ul className="space-y-2">
              {characters.map((desc, i) => (
                <li
                  key={i}
                  className="rounded-md border border-border bg-background/80 p-2 text-muted-foreground text-xs"
                >
                  {desc}
                </li>
              ))}
            </ul>
          )}
        </CollapsibleSection>

        <CollapsibleSection label="Illustration style" defaultOpen={false}>
          {illustrationStyle ? (
            <p className="text-muted-foreground break-words whitespace-pre-wrap rounded-md border border-border bg-muted/50 p-2 max-h-24 overflow-y-auto text-xs">
              {illustrationStyle}
            </p>
          ) : (
            <p className="text-muted-foreground">No style set.</p>
          )}
        </CollapsibleSection>

        <CollapsibleSection label="Plot" defaultOpen={false}>
          {plotToShow ? (
            <p className="text-muted-foreground text-xs">{plotToShow}</p>
          ) : (
            <p className="text-muted-foreground">No plot summary.</p>
          )}
        </CollapsibleSection>
      </div>
    </>
  )
}

export function NarratorRightPanel({ currentPage }: NarratorViewProps) {
  const coverImageDataUrl =
    currentPage.coverImageBase64 && currentPage.coverImageMimeType
      ? `data:${currentPage.coverImageMimeType};base64,${currentPage.coverImageBase64}`
      : null
  const pageKey = `${currentPage.shortPlot.slice(0, 80)}-${currentPage.coverImageBase64?.slice(0, 20) ?? "no-img"}`

  return (
    <div className="relative w-full flex-1 min-h-0 min-w-0 overflow-hidden flex items-center justify-center">
      {coverImageDataUrl ? (
        <img
          key={pageKey}
          src={coverImageDataUrl}
          alt="Story page"
          className={cn(
            "max-w-full max-h-full object-contain",
            "animate-in fade-in duration-300",
          )}
        />
      ) : null}
    </div>
  )
}

export function NarratorView(props: NarratorViewProps) {
  return (
    <div className="w-full h-full flex flex-col md:flex-row min-h-0 gap-4 md:gap-6 p-4 md:p-6 overflow-hidden">
      <aside className="flex flex-col w-full md:w-80 md:min-w-[280px] md:max-w-[360px] shrink-0 border border-border bg-muted/20 rounded-lg p-4 overflow-y-auto">
        <NarratorLeftPanel {...props} />
      </aside>
      <section className="flex-1 min-w-0 flex flex-col gap-4 overflow-y-auto">
        <NarratorRightPanel {...props} />
      </section>
    </div>
  )
}
