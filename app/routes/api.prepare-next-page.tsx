import type { CharacterDetails } from "~/lib/gemini-live.types"
import { buildIllustrationPrompt } from "~/lib/gemini-live.types"

type ActionArgs = { request: Request }

const NEXT_PAGE_MODEL = "gemini-2.0-flash"
const IMAGE_MODEL = "gemini-2.5-flash-image"

const NEXT_PAGE_PROMPT = `You are preparing the next page of a kids' storybook. Given the story so far (transcript) and the current page plot, output a JSON object with these keys (no other text, no markdown code fence):

"shortPlot": A short plot summary in 2-4 sentences for the NEXT page/section of the story. It should follow naturally from the current page and the conversation. Keep it suitable for a narrator to read aloud.

"characterUpdates": (optional) An array of character objects to update for consistent illustrations. Only include when the story implies a change: a new character appears (add one with name, age?, hair?, eyes?, clothing?, style?), or an existing character's appearance changes (include only that character with updated fields). Each object must have "name" (string). Omit or use [] if nothing changed.

Output only the JSON object, nothing else.`

function parseCharacterDetails(raw: unknown): CharacterDetails | null {
  if (!raw || typeof raw !== "object" || !("name" in raw)) return null
  const o = raw as Record<string, unknown>
  const name = typeof o.name === "string" ? o.name.trim() : ""
  if (!name) return null
  return {
    name,
    age: typeof o.age === "string" ? o.age.trim() : undefined,
    hair: typeof o.hair === "string" ? o.hair.trim() : undefined,
    eyes: typeof o.eyes === "string" ? o.eyes.trim() : undefined,
    clothing: typeof o.clothing === "string" ? o.clothing.trim() : undefined,
    style: typeof o.style === "string" ? o.style.trim() : undefined,
  }
}

function parseNextPageResponse(text: string): {
  shortPlot: string
  characterUpdates: CharacterDetails[]
} | null {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (parsed && typeof parsed === "object" && "shortPlot" in parsed) {
      const shortPlot =
        typeof (parsed as { shortPlot: unknown }).shortPlot === "string"
          ? (parsed as { shortPlot: string }).shortPlot
          : ""
      const rawUpdates = (parsed as { characterUpdates?: unknown })
        .characterUpdates
      const characterUpdates = Array.isArray(rawUpdates)
        ? rawUpdates
            .map(parseCharacterDetails)
            .filter((c): c is CharacterDetails => c !== null)
        : []
      return { shortPlot, characterUpdates }
    }
  } catch {
    // ignore
  }
  return null
}

export async function action({ request }: ActionArgs) {
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

  let body: {
    transcript?: string
    currentShortPlot?: string
    storySetup?: string
    characters?: unknown
    illustrationStyle?: string
  }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const transcript = typeof body.transcript === "string" ? body.transcript : ""
  const currentShortPlot =
    typeof body.currentShortPlot === "string" ? body.currentShortPlot : ""
  const storySetup = typeof body.storySetup === "string" ? body.storySetup : ""
  const illustrationStyle =
    typeof body.illustrationStyle === "string" && body.illustrationStyle.trim()
      ? body.illustrationStyle.trim()
      : ""

  const { GoogleGenAI } = await import("@google/genai")
  const client = new GoogleGenAI({ apiKey: apiKey.trim() })

  const contents = `${NEXT_PAGE_PROMPT}

Current page plot:
${currentShortPlot || "(None)"}
${transcript ? `\nConversation so far:\n${transcript}` : ""}
${storySetup ? `\nOriginal story setup:\n${storySetup}` : ""}`

  try {
    const response = await client.models.generateContent({
      model: NEXT_PAGE_MODEL,
      contents,
    })

    const text = response.text ?? ""
    const result = parseNextPageResponse(text)
    if (!result) {
      return Response.json({ nextShortPlot: "" }, { status: 200 })
    }

    const imagePromptContent =
      illustrationStyle !== ""
        ? buildIllustrationPrompt(illustrationStyle, result.shortPlot)
        : `Create a single children's storybook illustration for this page. Style: whimsical, colorful, friendly, suitable for kids. The image should capture the mood and main idea of this page—no text or words in the image. Page: ${result.shortPlot}`
    const imagePrompt = `Create a single children's storybook illustration for this page. No text or words in the image. ${imagePromptContent}`

    let nextCoverImageBase64: string | undefined
    let nextCoverImageMimeType: string | undefined
    try {
      const imageResponse = await client.models.generateContent({
        model: IMAGE_MODEL,
        contents: imagePrompt,
      })
      type ImagePart = { inlineData?: { data?: string; mimeType?: string } }
      type ImageContent = { content?: { parts?: ImagePart[] } }
      type ImageResponse = { candidates?: ImageContent[] }
      const candidate = (imageResponse as ImageResponse).candidates?.[0]
      const parts = candidate?.content?.parts
      if (parts?.length) {
        for (const part of parts) {
          const inlineData = (part as ImagePart).inlineData
          if (inlineData?.data) {
            nextCoverImageBase64 = inlineData.data
            nextCoverImageMimeType = inlineData.mimeType ?? "image/png"
            break
          }
        }
      }
    } catch {
      // continue without image
    }

    return Response.json({
      nextShortPlot: result.shortPlot,
      ...(result.characterUpdates.length > 0 && {
        characterUpdates: result.characterUpdates,
      }),
      ...(nextCoverImageBase64 && {
        nextCoverImageBase64,
        nextCoverImageMimeType: nextCoverImageMimeType ?? "image/png",
      }),
    })
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to prepare next page"
    return Response.json({ error: message }, { status: 500 })
  }
}
