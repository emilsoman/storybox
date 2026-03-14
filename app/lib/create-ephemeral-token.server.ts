/**
 * Server-only: create an ephemeral token for the Live API.
 * Uses GEMINI_API_KEY from env. Token is short-lived and can be locked to config.
 * @see https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens
 */

const MODEL = "gemini-2.5-flash-native-audio-preview-12-2025"

const STORY_SETUP_SYSTEM_INSTRUCTION = `You are a friendly story co-creator helping someone set up a kids' storybook. Your job is to collect a clear "story thread": who the characters are, where the story takes place, the tone (e.g. funny, gentle, adventurous), and any plot ideas they have.

Keep your replies short and conversational so they work well when spoken aloud. Ask one or two questions at a time. Start by greeting them and asking about the main character or the kind of story they want. When they seem done or say they're finished, briefly summarize the story thread so we have a clear picture for the next step.`

export async function createEphemeralToken(): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey?.trim()) {
    throw new Error("GEMINI_API_KEY is not set")
  }

  const { GoogleGenAI, Modality } = await import("@google/genai")
  const client = new GoogleGenAI({
    apiKey: apiKey.trim(),
    httpOptions: { apiVersion: "v1alpha" as const },
  })

  const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString()
  const newSessionExpireTime = new Date(
    Date.now() + 1 * 60 * 1000,
  ).toISOString()

  const token = await client.authTokens.create({
    config: {
      uses: 1,
      expireTime,
      newSessionExpireTime,
      liveConnectConstraints: {
        model: MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: STORY_SETUP_SYSTEM_INSTRUCTION,
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: "Puck" },
            },
          },
        },
      },
      httpOptions: { apiVersion: "v1alpha" as const },
    },
  })

  if (!token?.name) {
    throw new Error("Failed to create ephemeral token")
  }
  return token.name
}
