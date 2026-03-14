import type { Route } from "./+types/api.story-setup"

const STORY_SETUP_MODEL = "gemini-2.0-flash"

const STORY_SETUP_PROMPT = `You are summarizing a conversation where someone is setting up a kids' story with an AI assistant. Based on the conversation transcript below, produce a short "Story setup" in markdown only. Use these sections when there is enough information; otherwise omit or use a placeholder like "Not yet decided":

- **Characters** (who is in the story)
- **Setting** (where it takes place)
- **Tone** (e.g. funny, gentle, adventurous)
- **Plot ideas** (any events or goals mentioned)

Output only valid markdown. Update or fill in only what can be inferred from the transcript; keep the rest minimal. If the transcript is empty or too short, return a single line like "Share something about your story to see the setup here."`

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
