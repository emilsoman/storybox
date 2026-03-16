import { useState } from "react"
import { Mic, MicOff, Phone, PhoneOff, Send, Camera } from "lucide-react"
import { Button } from "~/components/ui/button"
import { cn } from "~/lib/utils"
import type { UseStorySetupAgentReturn } from "~/lib/gemini-live.types"
import { useCameraCapture } from "~/lib/useCameraCapture"

export function StorySetupView({
  connectionState,
  error,
  transcriptLines,
  connect,
  disconnect,
  sendTurn,
  isMicrophoneOn,
  startMicrophone,
  stopMicrophone,
  sendImage,
  reportError,
}: UseStorySetupAgentReturn) {
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

  const agentLines = transcriptLines.filter((e) => e.role === "agent")
  const latestAgent = agentLines[agentLines.length - 1]

  return (
    <div className="flex flex-col h-full">
      {cameraModal}
      <header className="space-y-1 mb-4">
        <h1 className="text-xl font-semibold tracking-tight">
          Set up your story
        </h1>
        <p className="text-muted-foreground text-sm">
          Tell me about the characters and what happens in your story.
        </p>
      </header>

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
              Start story setup
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

      {latestAgent?.text?.trim() ? (
        <div
          className="mt-4 bg-muted/30 p-3 flex flex-col"
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
      ) : null}
    </div>
  )
}
