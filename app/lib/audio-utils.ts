/**
 * Audio utilities for Gemini Live API (aligned with reference MediaHandler):
 * - Mic capture: AudioWorklet → Float32 chunks → downsample to 16 kHz → Int16 → base64
 * - Playback: 24 kHz 16-bit PCM, scheduled sources, stop-all on interrupt
 */

const LIVE_INPUT_SAMPLE_RATE = 16000
const LIVE_OUTPUT_SAMPLE_RATE = 24000
const WORKLET_BUFFER_SIZE = 4096

/** Single shared context for capture and playback (reference uses one MediaHandler.audioContext) */
let sharedAudioContext: AudioContext | null = null

function getAudioContext(): AudioContext {
  if (!sharedAudioContext) {
    sharedAudioContext = new (
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext
    )()
  }
  return sharedAudioContext
}

/** Downsample Float32 buffer (reference downsampleBuffer) */
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
    let accum = 0,
      count = 0
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i]
      count++
    }
    result[offsetResult] = count ? accum / count : 0
    offsetResult++
    offsetBuffer = nextOffsetBuffer
  }
  return result
}

/** Float32 → Int16 (reference convertFloat32ToInt16) */
function convertFloat32ToInt16(buffer: Float32Array): ArrayBuffer {
  const buf = new Int16Array(buffer.length)
  for (let i = 0; i < buffer.length; i++) {
    buf[i] = Math.min(1, Math.max(-1, buffer[i])) * 0x7fff
  }
  return buf.buffer
}

/** Int16 ArrayBuffer → base64 for API */
function int16BufferToBase64(arrayBuffer: ArrayBuffer): string {
  const bytes = new Uint8Array(arrayBuffer)
  let binary = ""
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/** Reference-style worklet: buffer 4096 Float32, post when full */
const PCM_WORKLET_CODE = `
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = ${WORKLET_BUFFER_SIZE};
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
  }
  process(inputs, outputs, params) {
    const input = inputs[0];
    if (!input || !input.length) return true;
    const channelData = input[0];
    for (let i = 0; i < channelData.length; i++) {
      this.buffer[this.bufferIndex++] = channelData[i];
      if (this.bufferIndex >= this.bufferSize) {
        this.port.postMessage(this.buffer);
        this.bufferIndex = 0;
      }
    }
    return true;
  }
}
registerProcessor("pcm-processor", PCMProcessor);
`

/** Scheduled playback sources (reference: scheduledSources, stopAudioPlayback) */
const scheduledSources: AudioBufferSourceNode[] = []
let nextStartTime = 0

export type MicCapture = {
  stop: () => void
}

/**
 * Initialize shared AudioContext (call on user gesture before capture/playback).
 * Reference: mediaHandler.initializeAudio() before connect.
 */
export function initializeAudio(): Promise<void> {
  const ctx = getAudioContext()
  if (ctx.state === "suspended") {
    return ctx.resume()
  }
  return Promise.resolve()
}

/**
 * Capture microphone at 16 kHz, 16-bit PCM; call onChunk with base64.
 * Worklet posts Float32; we downsample to 16 kHz and convert to Int16 (reference flow).
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

    const ctx = getAudioContext()
    try {
      if (ctx.state === "suspended") await ctx.resume()
      const blob = new Blob([PCM_WORKLET_CODE], {
        type: "application/javascript",
      })
      const workletUrl = URL.createObjectURL(blob)
      await ctx.audioWorklet.addModule(workletUrl)
      URL.revokeObjectURL(workletUrl)
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop())
      reject(new Error("Failed to load audio worklet"))
      return
    }

    const source = ctx.createMediaStreamSource(stream)
    const workletNode = new AudioWorkletNode(ctx, "pcm-processor")

    workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
      const downsampled = downsampleBuffer(
        event.data,
        ctx.sampleRate,
        LIVE_INPUT_SAMPLE_RATE,
      )
      const pcm16 = convertFloat32ToInt16(downsampled)
      onChunk(int16BufferToBase64(pcm16))
    }

    source.connect(workletNode)
    const muteGain = ctx.createGain()
    muteGain.gain.value = 0
    workletNode.connect(muteGain)
    muteGain.connect(ctx.destination)

    resolve({
      stop: () => {
        workletNode.disconnect()
        source.disconnect()
        muteGain.disconnect()
        stream.getTracks().forEach((t) => t.stop())
      },
    })
  })
}

/**
 * Play 24 kHz 16-bit PCM from API (reference playAudio).
 * Schedules at nextStartTime for gapless playback; no queue.
 */
export function playPcm24kBase64(base64: string): void {
  const ctx = getAudioContext()
  if (ctx.state === "suspended") ctx.resume()

  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  const pcmData = new Int16Array(bytes.buffer)
  const float32Data = new Float32Array(pcmData.length)
  for (let i = 0; i < pcmData.length; i++) {
    float32Data[i] = pcmData[i] / 32768.0
  }

  const buffer = ctx.createBuffer(
    1,
    float32Data.length,
    LIVE_OUTPUT_SAMPLE_RATE,
  )
  buffer.getChannelData(0).set(float32Data)

  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(ctx.destination)

  const now = ctx.currentTime
  nextStartTime = Math.max(now, nextStartTime)
  source.start(nextStartTime)
  nextStartTime += buffer.duration

  scheduledSources.push(source)
  source.onended = () => {
    const idx = scheduledSources.indexOf(source)
    if (idx > -1) scheduledSources.splice(idx, 1)
  }
}

/**
 * Stop all playback immediately (reference stopAudioPlayback).
 * Call when server sends interrupted so the model doesn’t talk over the user.
 */
export function clearPlaybackBuffer(): void {
  scheduledSources.forEach((s) => {
    try {
      s.stop()
    } catch {
      /* already stopped */
    }
  })
  scheduledSources.length = 0
  const ctx = sharedAudioContext
  if (ctx) {
    nextStartTime = ctx.currentTime
  }
}

/** Disconnect and close shared context (e.g. on session end). */
export function stopPlayback(): void {
  clearPlaybackBuffer()
  nextStartTime = 0
  if (sharedAudioContext) {
    sharedAudioContext.close()
    sharedAudioContext = null
  }
}
