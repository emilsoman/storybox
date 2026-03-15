/**
 * Camera capture for Gemini Live API using ImageCapture.
 * Takes a single photo and returns base64 JPEG. No fallback.
 */

export type TakePictureResult = {
  base64: string
  mimeType: string
}

/**
 * Request camera stream. Caller must stop tracks when done.
 */
export async function getCameraStream(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ video: true })
}

/**
 * Capture a single photo from the stream using ImageCapture.takePhoto().
 * Returns base64 JPEG. Does not stop the stream (caller owns it).
 */
export async function takePhotoFromStream(
  stream: MediaStream,
): Promise<TakePictureResult> {
  const track = stream.getVideoTracks()[0]
  if (!track) {
    throw new Error("No video track in stream")
  }
  const ImageCaptureApi = (
    window as Window & {
      ImageCapture?: new (track: MediaStreamTrack) => {
        takePhoto(): Promise<Blob>
      }
    }
  ).ImageCapture
  if (!ImageCaptureApi) {
    throw new Error("ImageCapture not supported")
  }
  const capture = new ImageCaptureApi(track)
  const blob = await capture.takePhoto()
  const base64 = await blobToBase64(blob)
  return { base64, mimeType: blob.type || "image/jpeg" }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const dataUrl = reader.result as string
      const base64 = dataUrl.split(",")[1]
      resolve(base64 ?? "")
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/**
 * Get camera stream, take one photo, stop the stream, and return base64 JPEG.
 */
export async function takePicture(): Promise<TakePictureResult> {
  const stream = await getCameraStream()
  try {
    const result = await takePhotoFromStream(stream)
    return result
  } finally {
    stream.getTracks().forEach((t) => t.stop())
  }
}
