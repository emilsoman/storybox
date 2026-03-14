import { Mic, MicOff, Phone, PhoneOff } from "lucide-react"
import { Button } from "~/components/ui/button"
import { useGeminiLive } from "~/lib/useGeminiLive"

export function VoiceChat() {
  const {
    connectionState,
    error,
    transcript,
    connect,
    disconnect,
    startMute,
    stopMute,
    isMuted,
  } = useGeminiLive()

  const handleConnect = () => {
    if (connectionState === "connected") {
      disconnect()
    } else {
      connect()
    }
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
            <Button
              variant="outline"
              size="lg"
              onClick={() => (isMuted ? stopMute() : startMute())}
              className="min-w-[200px]"
            >
              {isMuted ? (
                <>
                  <MicOff className="mr-2 size-5" />
                  Unmute
                </>
              ) : (
                <>
                  <Mic className="mr-2 size-5" />
                  Mute
                </>
              )}
            </Button>
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
    </main>
  )
}
