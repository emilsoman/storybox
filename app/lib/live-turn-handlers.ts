import type { MutableRefObject } from "react"
import type { LiveServerMessage } from "@google/genai/web"
import { clearPlaybackBuffer, playPcmBase64Chunk } from "~/lib/audio-utils"
import type { TranscriptEntry } from "~/lib/gemini-live.types"

export type HandleModelTurnDeps = {
  setTranscriptLines: (
    updater: (prev: TranscriptEntry[]) => TranscriptEntry[],
  ) => void
  audioPartsRef: MutableRefObject<string[]>
  mimeTypeRef: MutableRefObject<string>
}

export function createHandleModelTurn(
  deps: HandleModelTurnDeps,
): (message: LiveServerMessage) => void {
  const { setTranscriptLines, audioPartsRef, mimeTypeRef } = deps
  return function handleModelTurn(message: LiveServerMessage): void {
    const content = message.serverContent
    if (!content) return

    if (content.interrupted) {
      clearPlaybackBuffer()
      audioPartsRef.current = []
    }

    if (content.inputTranscription?.text) {
      const chunk = content.inputTranscription.text
      const finished = content.inputTranscription.finished ?? false
      setTranscriptLines((prev) => {
        const last = prev[prev.length - 1]
        if (last?.role === "user" && !finished) {
          return [
            ...prev.slice(0, -1),
            { role: "user", text: last.text + chunk },
          ]
        }
        return [...prev, { role: "user", text: chunk }]
      })
    }

    if (content.outputTranscription?.text) {
      const chunk = content.outputTranscription.text
      setTranscriptLines((prev) => {
        const last = prev[prev.length - 1]
        if (last?.role === "agent") {
          return [
            ...prev.slice(0, -1),
            { role: "agent", text: last.text + chunk },
          ]
        }
        return [...prev, { role: "agent", text: chunk }]
      })
    }

    const parts = content.modelTurn?.parts
    if (parts) {
      const part = parts[0]
      if (part?.inlineData) {
        const data = part.inlineData?.data ?? ""
        if (data) {
          playPcmBase64Chunk(data).catch(() => {})
        }
        if (part.inlineData?.mimeType) {
          mimeTypeRef.current = part.inlineData.mimeType
        }
      }
    }

    if (content.turnComplete) {
      audioPartsRef.current = []
    }
  }
}

/**
 * Returns a function that waits for the next message in the queue (pop only).
 * Messages are processed in onmessage when they arrive, so we do not call
 * handleModelTurn here — this is only used by the turn loop to wait for
 * turnComplete. Audio-only input triggers agent turns that are processed
 * as soon as they arrive via onmessage.
 */
export function createWaitMessage(
  queueRef: MutableRefObject<LiveServerMessage[]>,
  _handleModelTurn: (message: LiveServerMessage) => void,
): () => Promise<LiveServerMessage> {
  return function waitMessage(): Promise<LiveServerMessage> {
    return new Promise((resolve) => {
      const check = () => {
        const message = queueRef.current.shift()
        if (message) {
          resolve(message)
          return
        }
        setTimeout(check, 100)
      }
      check()
    })
  }
}

export function createHandleTurnSetup(
  waitMessage: () => Promise<LiveServerMessage>,
): () => Promise<LiveServerMessage | null> {
  return async function handleTurnSetup(): Promise<LiveServerMessage | null> {
    let done = false
    let lastMessage: LiveServerMessage | null = null
    let toolCallMessage: LiveServerMessage | null = null
    while (!done) {
      const message = await waitMessage()
      lastMessage = message
      if (message.toolCall) {
        toolCallMessage = message
      }
      if (message.serverContent?.turnComplete) {
        done = true
      }
    }
    return toolCallMessage ?? lastMessage
  }
}

export function createHandleTurnNarrator(
  waitMessage: () => Promise<LiveServerMessage>,
): () => Promise<void> {
  return async function handleTurnNarrator(): Promise<void> {
    let done = false
    while (!done) {
      const message = await waitMessage()
      if (message.serverContent?.turnComplete) {
        done = true
      }
    }
  }
}
