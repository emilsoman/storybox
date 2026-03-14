/**
 * Server-only: create an ephemeral token for the Live API.
 * Uses GEMINI_API_KEY from env. Token is short-lived and can be locked to config.
 * @see https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens
 */

export async function createEphemeralToken(): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey?.trim()) {
    throw new Error("GEMINI_API_KEY is not set")
  }

  const { GoogleGenAI } = await import("@google/genai")
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
      httpOptions: { apiVersion: "v1alpha" as const },
    },
  })

  if (!token?.name) {
    throw new Error("Failed to create ephemeral token")
  }
  return token.name
}
