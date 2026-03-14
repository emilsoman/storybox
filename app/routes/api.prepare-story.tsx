import type { Route } from "./+types/api.prepare-story"

const PREPARE_STORY_MODEL = "gemini-2.0-flash"

const VOICE_NAMES =
  "Zephyr, Kore, Orus, Autonoe, Umbriel, Erinome, Laomedeia, Schedar, Achird, Sadachbia, Puck, Fenrir, Aoede, Enceladus, Algieba, Algenib, Achernar, Gacrux, Zubenelgenubi, Sadaltager, Charon, Leda, Callirrhoe, Iapetus, Despina, Rasalgethi, Alnilam, Pulcherrima, Vindemiatrix, Sulafat"

const PREPARE_STORY_PROMPT = `You are preparing a kids' storybook session. Given the story setup below, output a JSON object with exactly these three keys (no other text, no markdown code fence):

1. "shortPlot": A short plot summary in 2-4 sentences that a narrator will use as the story outline.
2. "lucideIconNames": An array of 3-5 Lucide icon names in PascalCase that fit the story (e.g. BookOpen, Sparkles, TreePine, Castle, Sun, Moon). Use only real Lucide icon names from the lucide-react library.
3. "voiceName": Exactly one voice name from this list (pick the one that best fits the story tone): ${VOICE_NAMES}

Output only the JSON object, nothing else.`

const VALID_VOICE_NAMES = new Set(VOICE_NAMES.split(", ").map((s) => s.trim()))

function parsePrepareStoryResponse(text: string): {
  shortPlot: string
  lucideIconNames: string[]
  voiceName: string
} | null {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (
      parsed &&
      typeof parsed === "object" &&
      "shortPlot" in parsed &&
      "lucideIconNames" in parsed &&
      "voiceName" in parsed
    ) {
      const shortPlot =
        typeof (parsed as { shortPlot: unknown }).shortPlot === "string"
          ? (parsed as { shortPlot: string }).shortPlot
          : ""
      const rawIcons = (parsed as { lucideIconNames: unknown }).lucideIconNames
      const lucideIconNames = Array.isArray(rawIcons)
        ? rawIcons.filter((x): x is string => typeof x === "string")
        : []
      let voiceName = String((parsed as { voiceName: unknown }).voiceName ?? "")
      if (!VALID_VOICE_NAMES.has(voiceName)) {
        voiceName = "Zephyr"
      }
      return { shortPlot, lucideIconNames, voiceName }
    }
  } catch {
    // ignore
  }
  return null
}

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

  let body: { storySetup?: string; transcript?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const storySetup = typeof body.storySetup === "string" ? body.storySetup : ""
  const transcript = typeof body.transcript === "string" ? body.transcript : ""

  const { GoogleGenAI } = await import("@google/genai")
  const client = new GoogleGenAI({ apiKey: apiKey.trim() })

  const contents = `${PREPARE_STORY_PROMPT}

Story setup:
${storySetup || "(None provided)"}
${transcript ? `\nConversation transcript (for context):\n${transcript}` : ""}`

  try {
    const response = await client.models.generateContent({
      model: PREPARE_STORY_MODEL,
      contents,
    })

    const text = response.text ?? ""
    const result = parsePrepareStoryResponse(text)
    if (!result) {
      return Response.json(
        {
          shortPlot: "",
          lucideIconNames: [],
          voiceName: "Zephyr",
        },
        { status: 200 },
      )
    }
    return Response.json(result)
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to prepare story"
    return Response.json({ error: message }, { status: 500 })
  }
}
