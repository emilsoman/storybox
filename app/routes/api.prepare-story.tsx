import type { Route } from "./+types/api.prepare-story"
import {
  buildIllustrationPrompt,
  buildIllustrationStylePrefix,
  DEFAULT_GLOBAL_ILLUSTRATION_STYLE,
} from "~/lib/gemini-live.types"

const PREPARE_STORY_MODEL = "gemini-2.0-flash"
const IMAGE_MODEL = "gemini-3.1-flash-image-preview"

const VOICE_NAMES_WITH_TONES = `Puck -- Upbeat, Charon -- Informative, Kore -- Firm, Fenrir -- Excitable, Leda -- Youthful, Orus -- Firm, Aoede -- Breezy, Callirrhoe -- Easy-going, Autonoe -- Bright, Enceladus -- Breathy, Iapetus -- Clear, Umbriel -- Easy-going, Algieba -- Smooth, Despina -- Smooth, Erinome -- Clear, Algenib -- Gravelly, Rasalgethi -- Informative, Laomedeia -- Upbeat, Achernar -- Soft, Alnilam -- Firm, Schedar -- Even, Gacrux -- Mature, Pulcherrima -- Forward, Achird -- Friendly, Zubenelgenubi -- Casual, Vindemiatrix -- Gentle, Sadachbia -- Lively, Sadaltager -- Knowledgeable, Sulafat -- Warm`

const VALID_VOICE_NAMES_LIST = VOICE_NAMES_WITH_TONES.split(", ")
  .map((s) => s.split(" -- ")[0].trim())
  .join(", ")

const PREPARE_STORY_PROMPT = `You are preparing a kids' storybook session. Given the story setup below, output a JSON object with exactly these four keys (no other text, no markdown code fence):

1. "shortPlot": A short plot summary in 2-4 sentences that a narrator will use as the story outline.
2. "voiceName": The narrator voice. You must use exactly one of these names (the first word from each option): ${VALID_VOICE_NAMES_LIST}. To choose, use the tone hints: ${VOICE_NAMES_WITH_TONES}. Example: for an excitable story use "Fenrir", not "Excitable".
3. "characters": An array of strings. Each string is a full character description (name and any physical/visual details) for consistent image generation across pages. Example: ["Luma, 9, short curly black hair, large green eyes, yellow raincoat and red boots, soft watercolor style", "A friendly dragon with emerald scales"]. Use an empty array [] if there are no specific characters.
4. "illustrationStyle": A short string describing the illustration style for all pages (e.g. "soft watercolor children's book illustration"). This will be used for every page image.

Output only the JSON object, nothing else.`

const VALID_VOICE_NAMES = new Set(
  VOICE_NAMES_WITH_TONES.split(", ").map((s) => s.split(" -- ")[0].trim()),
)

function parsePrepareStoryResponse(text: string): {
  shortPlot: string
  voiceName: string
  characters: string[]
  illustrationStyle: string
} | null {
  console.log("prepare story response text", text)
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
      "voiceName" in parsed &&
      "characters" in parsed &&
      "illustrationStyle" in parsed
    ) {
      console.log("voice is", parsed.voiceName)
      const shortPlot =
        typeof (parsed as { shortPlot: unknown }).shortPlot === "string"
          ? (parsed as { shortPlot: string }).shortPlot
          : ""
      let voiceName = String((parsed as { voiceName: unknown }).voiceName ?? "")
      if (!VALID_VOICE_NAMES.has(voiceName)) {
        voiceName = "Zephyr"
      }
      const rawChars = (parsed as { characters: unknown }).characters
      const characters = Array.isArray(rawChars)
        ? rawChars.filter((x): x is string => typeof x === "string")
        : []
      const rawStyle = (parsed as { illustrationStyle: unknown })
        .illustrationStyle
      const illustrationStyle =
        typeof rawStyle === "string" && rawStyle.trim()
          ? rawStyle.trim()
          : DEFAULT_GLOBAL_ILLUSTRATION_STYLE
      return {
        shortPlot,
        voiceName,
        characters,
        illustrationStyle,
      }
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
          voiceName: "Zephyr",
          characters: [],
          illustrationStyle: DEFAULT_GLOBAL_ILLUSTRATION_STYLE,
        },
        { status: 200 },
      )
    }

    const illustrationStyle = result.illustrationStyle
    const stylePrefix = buildIllustrationStylePrefix(
      result.characters,
      illustrationStyle,
    )
    const imagePromptFull = buildIllustrationPrompt(stylePrefix, result.shortPlot)
    const imagePrompt = `Create a single children's storybook cover illustration. No text or words in the image. ${imagePromptFull}`

    let coverImageBase64: string | undefined
    let coverImageMimeType: string | undefined
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
            coverImageBase64 = inlineData.data
            coverImageMimeType = inlineData.mimeType ?? "image/png"
            break
          }
        }
      }
    } catch {
      // continue without cover image
    }

    return Response.json({
      shortPlot: result.shortPlot,
      voiceName: result.voiceName,
      characters: result.characters,
      illustrationStyle,
      ...(coverImageBase64 && {
        coverImageBase64,
        coverImageMimeType: coverImageMimeType ?? "image/png",
      }),
    })
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to prepare story"
    return Response.json({ error: message }, { status: 500 })
  }
}
