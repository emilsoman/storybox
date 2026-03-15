/**
 * Microphone capture for Gemini Live API.
 * Follows the pattern from gemini-live-api-examples media-handler.js:
 * - Worklet connected to muteGain -> destination so process() runs
 * - Default AudioContext sample rate; downsample to 16 kHz in main thread
 * - PCM 16-bit LE, base64, sent via callback (Live API: audio/pcm;rate=16000)
 * @see https://github.com/google-gemini/gemini-live-api-examples/blob/main/gemini-live-genai-python-sdk/frontend/media-handler.js
 * @see https://ai.google.dev/gemini-api/docs/live-api/capabilities
 */

const TARGET_SAMPLE_RATE = 16000
const CAPTURE_BUFFER_SIZE = 4096

const CAPTURE_WORKLET_CODE = `
class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = ${CAPTURE_BUFFER_SIZE};
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
  }
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const channel = input[0];
      for (let i = 0; i < channel.length; i++) {
        this.buffer[this.bufferIndex++] = channel[i];
        if (this.bufferIndex >= this.bufferSize) {
          this.port.postMessage({ type: "audio", data: this.buffer.slice() });
          this.bufferIndex = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("audio-capture-processor", AudioCaptureProcessor);
`

/** Downsample Float32 buffer (e.g. 48k -> 16k) by averaging. Matches media-handler.js downsampleBuffer. */
function downsampleBuffer(
  buffer: Float32Array,
  sampleRate: number,
  outSampleRate: number,
): Float32Array {
  if (outSampleRate === sampleRate) return buffer
  const ratio = sampleRate / outSampleRate
  const newLength = Math.round(buffer.length / ratio)
  const result = new Float32Array(newLength)
  let offsetResult = 0
  let offsetBuffer = 0
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio)
    let accum = 0
    let count = 0
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i]
      count++
    }
    result[offsetResult] = count > 0 ? accum / count : 0
    offsetResult++
    offsetBuffer = nextOffsetBuffer
  }
  return result
}

function convertFloat32ToInt16(buffer: Float32Array): ArrayBuffer {
  const buf = new Int16Array(buffer.length)
  for (let i = 0; i < buffer.length; i++) {
    buf[i] = Math.min(1, Math.max(-1, buffer[i])) * 0x7fff
  }
  return buf.buffer
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return typeof btoa !== "undefined" ? btoa(binary) : ""
}

let captureContext: AudioContext | null = null
let captureWorklet: AudioWorkletNode | null = null
let captureMuteGain: GainNode | null = null
let captureInitPromise: Promise<void> | null = null

export type MicrophoneCapture = {
  start: (sendChunk: (base64: string) => void) => Promise<void>
  stop: () => void
}

export function createMicrophoneCapture(): MicrophoneCapture {
  let sendChunkRef: ((base64: string) => void) | null = null
  let active = false
  let currentStream: MediaStream | null = null
  let currentSource: MediaStreamAudioSourceNode | null = null

  const start = async (sendChunk: (base64: string) => void) => {
    if (active) return
    sendChunkRef = sendChunk
    active = true

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
      currentStream = stream

      // Default AudioContext (browser sample rate, e.g. 48 kHz) — same as media-handler
      if (!captureContext) {
        captureContext = new (
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext
        )()
      }
      const ctx = captureContext
      if (ctx.state === "suspended") await ctx.resume()

      if (!captureWorklet) {
        if (captureInitPromise) await captureInitPromise
        if (!captureWorklet) {
          captureInitPromise = (async () => {
            const blob = new Blob([CAPTURE_WORKLET_CODE], {
              type: "application/javascript",
            })
            const url = URL.createObjectURL(blob)
            await ctx.audioWorklet.addModule(url)
            URL.revokeObjectURL(url)
            captureWorklet = new AudioWorkletNode(
              ctx,
              "audio-capture-processor",
            )
            // Mute local feedback — worklet must be connected to destination for process() to run
            captureMuteGain = ctx.createGain()
            captureMuteGain.gain.value = 0
            captureWorklet.connect(captureMuteGain)
            captureMuteGain.connect(ctx.destination)
          })()
          await captureInitPromise
        }
      }

      const worklet = captureWorklet!
      const sampleRate = ctx.sampleRate
      worklet.port.onmessage = (event: MessageEvent) => {
        if (!active || event.data?.type !== "audio" || !sendChunkRef) return
        const float32 = event.data.data as Float32Array
        if (!float32?.length) return
        const downsampled = downsampleBuffer(
          float32,
          sampleRate,
          TARGET_SAMPLE_RATE,
        )
        const pcm = convertFloat32ToInt16(downsampled)
        const base64 = arrayBufferToBase64(pcm)
        if (base64) sendChunkRef(base64)
      }

      const source = ctx.createMediaStreamSource(stream)
      source.connect(worklet)
      currentSource = source
    } catch (err) {
      active = false
      currentStream = null
      currentSource = null
      throw err
    }
  }

  const stop = () => {
    active = false
    sendChunkRef = null
    if (currentSource) {
      currentSource.disconnect()
      currentSource = null
    }
    if (captureWorklet) {
      captureWorklet.port.onmessage = null
    }
    if (currentStream) {
      currentStream.getTracks().forEach((t) => t.stop())
      currentStream = null
    }
  }

  return { start, stop }
}
