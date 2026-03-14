/**
 * Audio utilities for Gemini Live API:
 * - Mic capture at 16 kHz, 16-bit PCM (required by the API)
 * - Playback of 24 kHz, 16-bit PCM (returned by the API)
 */

const LIVE_INPUT_SAMPLE_RATE = 16000
const LIVE_OUTPUT_SAMPLE_RATE = 24000

/** Convert Float32Array to 16-bit PCM base64 */
function float32ToPcmBase64(float32: Float32Array): string {
  const pcm = new Int16Array(float32.length)
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]))
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  const bytes = new Uint8Array(pcm.buffer)
  let binary = ""
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/** Convert 16-bit PCM ArrayBuffer (at any sample rate) to 16 kHz base64 for the API */
function pcmBufferTo16kBase64(
  pcmBuffer: ArrayBuffer,
  fromSampleRate: number,
): string {
  if (fromSampleRate === LIVE_INPUT_SAMPLE_RATE) {
    const bytes = new Uint8Array(pcmBuffer)
    let binary = ""
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
  }
  const pcm = new Int16Array(pcmBuffer)
  const float32 = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) {
    float32[i] = pcm[i] / (pcm[i] < 0 ? 0x8000 : 0x7fff)
  }
  const resampled = resample(float32, fromSampleRate, LIVE_INPUT_SAMPLE_RATE)
  return float32ToPcmBase64(resampled)
}

const PCM_CAPTURE_WORKLET_CODE = `
class PCMCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.sampleRate = options.processorOptions?.sampleRate ?? 44100;
  }
  process(inputs, outputs, params) {
    const channel = inputs[0]?.[0];
    if (!channel || channel.length === 0) return true;
    const pcm = new Int16Array(channel.length);
    for (let i = 0; i < channel.length; i++) {
      const s = Math.max(-1, Math.min(1, channel[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    this.port.postMessage({ pcm: pcm.buffer, sampleRate: this.sampleRate }, [pcm.buffer]);
    return true;
  }
}
registerProcessor('pcm-capture-processor', PCMCaptureProcessor);
`

/** Resample float32 from one sample rate to another (simple linear interpolation) */
function resample(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate) return input
  const ratio = fromRate / toRate
  const outLength = Math.floor(input.length / ratio)
  const output = new Float32Array(outLength)
  for (let i = 0; i < outLength; i++) {
    const srcIndex = i * ratio
    const index = Math.floor(srcIndex)
    const frac = srcIndex - index
    const next = Math.min(index + 1, input.length - 1)
    output[i] = input[index] * (1 - frac) + input[next] * frac
  }
  return output
}

export type MicCapture = {
  stop: () => void
}

/**
 * Capture microphone at 16 kHz, 16-bit PCM and call onChunk with base64 data.
 * Uses AudioWorklet (128-sample buffer) for low latency and stable timing; resamples to 16 kHz on the main thread when context rate differs.
 */
export function captureMic16k(
  onChunk: (base64Pcm: string) => void,
): Promise<MicCapture> {
  return new Promise(async (resolve, reject) => {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      reject(new Error("Microphone access denied"))
      return
    }

    const preferredRate = LIVE_INPUT_SAMPLE_RATE
    const ctx = new AudioContext({ sampleRate: preferredRate })
    const source = ctx.createMediaStreamSource(stream)

    try {
      const blob = new Blob([PCM_CAPTURE_WORKLET_CODE], {
        type: "application/javascript",
      })
      const workletUrl = URL.createObjectURL(blob)
      await ctx.audioWorklet.addModule(workletUrl)
      URL.revokeObjectURL(workletUrl)
    } catch (e) {
      ctx.close()
      stream.getTracks().forEach((t) => t.stop())
      reject(new Error("Failed to load audio worklet"))
      return
    }

    const workletNode = new AudioWorkletNode(ctx, "pcm-capture-processor", {
      processorOptions: { sampleRate: ctx.sampleRate },
      numberOfInputs: 1,
      numberOfOutputs: 1,
    })

    workletNode.port.onmessage = (
      e: MessageEvent<{ pcm: ArrayBuffer; sampleRate: number }>,
    ) => {
      const base64 = pcmBufferTo16kBase64(e.data.pcm, e.data.sampleRate)
      onChunk(base64)
    }

    const silentGain = ctx.createGain()
    silentGain.gain.value = 0
    silentGain.connect(ctx.destination)

    source.connect(workletNode)
    workletNode.connect(silentGain)

    resolve({
      stop: () => {
        workletNode.disconnect()
        source.disconnect()
        silentGain.disconnect()
        ctx.close()
        stream.getTracks().forEach((t) => t.stop())
      },
    })
  })
}

/** Queue and play 24 kHz 16-bit PCM chunks (API output) */
let playbackContext: AudioContext | null = null
const playbackQueue: ArrayBuffer[] = []
let isPlaying = false
/** Scheduled start time for the next chunk (gapless playback) */
let nextStartTime = 0
/** Current playback source; kept so we can stop it immediately on interruption */
let currentPlaybackSource: AudioBufferSourceNode | null = null

function getPlaybackContext(): AudioContext {
  if (!playbackContext) {
    playbackContext = new AudioContext({ sampleRate: LIVE_OUTPUT_SAMPLE_RATE })
  }
  return playbackContext
}

function playNextInQueue() {
  if (isPlaying || playbackQueue.length === 0) return
  isPlaying = true
  const chunk = playbackQueue.shift()!
  const ctx = getPlaybackContext()
  const pcm = new Int16Array(chunk)
  const float32 = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) {
    float32[i] = pcm[i] / (pcm[i] < 0 ? 0x8000 : 0x7fff)
  }
  const buffer = ctx.createBuffer(1, float32.length, LIVE_OUTPUT_SAMPLE_RATE)
  buffer.copyToChannel(float32, 0)
  const source = ctx.createBufferSource()
  currentPlaybackSource = source
  source.buffer = buffer
  source.connect(ctx.destination)
  if (nextStartTime <= ctx.currentTime) {
    nextStartTime = ctx.currentTime
  }
  const startWhen = nextStartTime
  nextStartTime += buffer.duration
  source.onended = () => {
    currentPlaybackSource = null
    isPlaying = false
    playNextInQueue()
  }
  source.start(startWhen)
}

/**
 * Decode base64 PCM (24 kHz, 16-bit, mono) from the Live API and queue for playback.
 */
export function playPcm24kBase64(base64: string): void {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  playbackQueue.push(bytes.buffer)
  playNextInQueue()
}

/**
 * Clear the playback queue and stop current playback immediately.
 * Call this when the server sends server_content with interrupted: true
 * so the agent does not continue talking over the user.
 */
export function clearPlaybackBuffer(): void {
  playbackQueue.length = 0
  nextStartTime = 0
  if (currentPlaybackSource) {
    try {
      currentPlaybackSource.stop()
    } catch {
      // already stopped
    }
    currentPlaybackSource = null
  }
  isPlaying = false
}

export function stopPlayback(): void {
  clearPlaybackBuffer()
  nextStartTime = 0
  if (playbackContext) {
    playbackContext.close()
    playbackContext = null
  }
}
