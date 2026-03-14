/**
 * Audio utilities for Gemini Live API.
 * - Streaming playback: AudioWorklet queue (official gemini-live-api-examples pattern) for in-order, low-latency playback.
 * - WAV helpers for parseMimeType, createWavHeader, convertToWav when needed.
 */

const LIVE_OUTPUT_SAMPLE_RATE = 24000

/** Single shared context for playback (24kHz to match Gemini output). */
let sharedAudioContext: AudioContext | null = null

function getAudioContext(): AudioContext {
  if (!sharedAudioContext) {
    sharedAudioContext = new (
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext
    )({ sampleRate: LIVE_OUTPUT_SAMPLE_RATE })
  }
  return sharedAudioContext
}

/** Scheduled playback sources (used by playWavFromBase64Parts). */
const scheduledSources: AudioBufferSourceNode[] = []
let nextStartTime = 0

/**
 * Playback worklet: queues Float32Array chunks and drains them in order (official pattern).
 * @see https://github.com/google-gemini/gemini-live-api-examples/tree/main/gemini-live-ephemeral-tokens-websocket/frontend
 */
const PLAYBACK_WORKLET_CODE = `
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.audioQueue = [];
    this.port.onmessage = (event) => {
      if (event.data === "interrupt") {
        this.audioQueue = [];
      } else if (event.data instanceof Float32Array) {
        this.audioQueue.push(event.data);
      }
    };
  }
  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (output.length === 0) return true;
    const channel = output[0];
    let outputIndex = 0;
    while (outputIndex < channel.length && this.audioQueue.length > 0) {
      const currentBuffer = this.audioQueue[0];
      if (!currentBuffer || currentBuffer.length === 0) {
        this.audioQueue.shift();
        continue;
      }
      const remainingOutput = channel.length - outputIndex;
      const remainingBuffer = currentBuffer.length;
      const copyLength = Math.min(remainingOutput, remainingBuffer);
      for (let i = 0; i < copyLength; i++) {
        channel[outputIndex++] = currentBuffer[i];
      }
      if (copyLength < remainingBuffer) {
        this.audioQueue[0] = currentBuffer.slice(copyLength);
      } else {
        this.audioQueue.shift();
      }
    }
    while (outputIndex < channel.length) {
      channel[outputIndex++] = 0;
    }
    return true;
  }
}
registerProcessor("pcm-processor", PCMProcessor);
`

let playbackWorkletNode: AudioWorkletNode | null = null
let playbackInitPromise: Promise<void> | null = null

async function ensurePlaybackWorklet(): Promise<AudioWorkletNode> {
  if (playbackWorkletNode) return playbackWorkletNode
  if (playbackInitPromise) {
    await playbackInitPromise
    return playbackWorkletNode!
  }
  playbackInitPromise = (async () => {
    const ctx = getAudioContext()
    if (ctx.state === "suspended") await ctx.resume()
    const blob = new Blob([PLAYBACK_WORKLET_CODE], {
      type: "application/javascript",
    })
    const url = URL.createObjectURL(blob)
    await ctx.audioWorklet.addModule(url)
    URL.revokeObjectURL(url)
    const node = new AudioWorkletNode(ctx, "pcm-processor")
    node.connect(ctx.destination)
    playbackWorkletNode = node
  })()
  await playbackInitPromise
  return playbackWorkletNode!
}

/**
 * Play a single base64 PCM chunk via the worklet queue (official pattern).
 * Chunks are played in order with no gaps. Call this for each inlineData as it arrives.
 */
export async function playPcmBase64Chunk(base64: string): Promise<void> {
  if (!base64) return
  const worklet = await ensurePlaybackWorklet()
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  const int16 = new Int16Array(bytes.buffer)
  const float32 = new Float32Array(int16.length)
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768
  }
  worklet.port.postMessage(float32)
}

export interface WavConversionOptions {
  numChannels: number
  sampleRate: number
  bitsPerSample: number
}

/** Parse mimeType (e.g. "audio/pcm;rate=24000" or "audio/L16;rate=24000") into WAV options. */
export function parseMimeType(mimeType: string): WavConversionOptions {
  const [fileType, ...params] = mimeType.split(";").map((s) => s.trim())
  const [, format] = fileType.split("/")

  const options: Partial<WavConversionOptions> = {
    numChannels: 1,
    bitsPerSample: 16,
    sampleRate: 24000,
  }

  if (format?.startsWith("L")) {
    const bits = parseInt(format.slice(1), 10)
    if (!isNaN(bits)) {
      options.bitsPerSample = bits
    }
  }

  for (const param of params) {
    const [key, value] = param.split("=").map((s) => s.trim())
    if (key === "rate") {
      options.sampleRate = parseInt(value, 10)
    }
  }

  return options as WavConversionOptions
}

/** Create WAV header (44 bytes). http://soundfile.sapp.org/doc/WaveFormat */
export function createWavHeader(
  dataLength: number,
  options: WavConversionOptions,
): Uint8Array {
  const { numChannels, sampleRate, bitsPerSample } = options
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8
  const blockAlign = (numChannels * bitsPerSample) / 8
  const buffer = new Uint8Array(44)
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)

  const write = (str: string, offset: number) => {
    for (let i = 0; i < str.length; i++) {
      buffer[offset + i] = str.charCodeAt(i)
    }
  }
  write("RIFF", 0)
  view.setUint32(4, 36 + dataLength, true)
  write("WAVE", 8)
  write("fmt ", 12)
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  write("data", 36)
  view.setUint32(40, dataLength, true)

  return buffer
}

/** Convert accumulated base64 PCM parts to WAV (browser-safe, no Node Buffer). */
export function convertToWav(rawData: string[], mimeType: string): Uint8Array {
  const options = parseMimeType(mimeType)
  const decoded = rawData.map((data) => {
    const binary = atob(data)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  })
  const dataLength = decoded.reduce((a, b) => a + b.length, 0)
  const wavHeader = createWavHeader(dataLength, options)
  const totalLength = wavHeader.length + dataLength
  const result = new Uint8Array(totalLength)
  result.set(wavHeader, 0)
  let offset = wavHeader.length
  for (const chunk of decoded) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

/**
 * Initialize shared AudioContext (call on user gesture before playback).
 */
export function initializeAudio(): Promise<void> {
  const ctx = getAudioContext()
  if (ctx.state === "suspended") {
    return ctx.resume()
  }
  return Promise.resolve()
}

/**
 * Convert accumulated base64 audio parts to WAV and play via decodeAudioData.
 * Reference: convertToWav(audioParts, ...) then write; we play once at turnComplete so playback is one continuous WAV in order.
 */
export function playWavFromBase64Parts(
  rawData: string[],
  mimeType: string,
): Promise<void> {
  if (rawData.length === 0) return Promise.resolve()
  const ctx = getAudioContext()
  if (ctx.state === "suspended") ctx.resume()

  const wavBytes = convertToWav(rawData, mimeType)
  const slice = wavBytes.buffer.slice(
    wavBytes.byteOffset,
    wavBytes.byteOffset + wavBytes.byteLength,
  ) as ArrayBuffer
  return ctx.decodeAudioData(slice).then((decoded) => {
    const source = ctx.createBufferSource()
    source.buffer = decoded
    source.connect(ctx.destination)

    const now = ctx.currentTime
    nextStartTime = Math.max(now, nextStartTime)
    source.start(nextStartTime)
    nextStartTime += decoded.duration

    scheduledSources.push(source)
    source.onended = () => {
      const idx = scheduledSources.indexOf(source)
      if (idx > -1) scheduledSources.splice(idx, 1)
    }
  })
}

/**
 * Stop all playback immediately (reference stopAudioPlayback).
 * Call when server sends interrupted so the model doesn’t talk over the user.
 */
export function clearPlaybackBuffer(): void {
  if (playbackWorkletNode) {
    playbackWorkletNode.port.postMessage("interrupt")
  }
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
  playbackWorkletNode = null
  playbackInitPromise = null
  if (sharedAudioContext) {
    sharedAudioContext.close()
    sharedAudioContext = null
  }
}
