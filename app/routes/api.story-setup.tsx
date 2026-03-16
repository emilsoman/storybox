import type { Route } from "./+types/api.story-setup"

const STORY_SETUP_MODEL = "gemini-2.0-flash"

const STORY_SETUP_PROMPT = `You are summarizing a conversation where someone is setting up a kids' story with an AI assistant. Based on the conversation transcript below, write a single short paragraph describing what the story is about, based only on what the user has said. Do not add sections or bullet points.

Output only valid markdown. If the transcript is empty or too short, return a single line like "Share something about your story to see the setup here."`

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response(null, { status: 405 })
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey?.trim()) {
    return Response.json(
      { error: "GEMINI_API_KEY is not set" },
      { status: 500 },
    )
  }

  let body: { transcript?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const transcript = typeof body.transcript === "string" ? body.transcript : ""

  const { GoogleGenAI } = await import("@google/genai")
  const client = new GoogleGenAI({ apiKey: apiKey.trim() })

  const contents = `${STORY_SETUP_PROMPT}\n\nConversation transcript:\n\n${transcript || "(No messages yet.)"}`

  try {
    const response = await client.models.generateContent({
      model: STORY_SETUP_MODEL,
      contents,
    })

    const text = response.text ?? ""
    return Response.json({ markdown: text })
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to generate story setup"
    return Response.json({ error: message }, { status: 500 })
  }
}
