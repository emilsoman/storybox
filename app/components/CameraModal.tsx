import { useEffect, useRef, useState } from "react"
import { Button } from "~/components/ui/button"
import { captureVideoFrame } from "~/lib/camera-capture"
import { getCameraStream } from "~/lib/camera-capture"

type CameraModalProps = {
  onCapture: (base64: string, mimeType: string) => void
  onCancel: () => void
}

export function CameraModal({ onCapture, onCancel }: CameraModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    getCameraStream()
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
        }
        setIsLoading(false)
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Camera access denied")
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  const handleCapture = () => {
    if (!videoRef.current) return
    const result = captureVideoFrame(videoRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    onCapture(result.base64, result.mimeType)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="flex flex-col items-center gap-4 w-full max-w-[640px] mx-4">
        <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden">
          {isLoading && !error && (
            <div className="absolute inset-0 flex items-center justify-center text-white text-sm">
              Starting camera…
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center text-red-400 text-sm px-4 text-center">
              {error}
            </div>
          )}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
        </div>
        <div className="flex gap-3">
          <Button
            variant="secondary"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            onClick={handleCapture}
            disabled={isLoading || !!error}
          >
            Take Photo
          </Button>
        </div>
      </div>
    </div>
  )
}
