import {
  buildIllustrationPrompt,
  buildIllustrationStylePrefix,
  DEFAULT_GLOBAL_ILLUSTRATION_STYLE,
} from "~/lib/gemini-live.types"

type ActionArgs = { request: Request }

const NEXT_PAGE_MODEL = "gemini-2.0-flash"
const IMAGE_MODEL = "gemini-2.5-flash-image"

const NEXT_PAGE_PROMPT = `You are preparing the next page of a kids' storybook. Given the story so far (transcript) and the current page plot, output a JSON object with these keys (no other text, no markdown code fence):

"shortPlot": A short plot summary in 2-4 sentences for the NEXT page/section of the story. It should follow naturally from the current page and the conversation. Keep it suitable for a narrator to read aloud.

"characterUpdates": (optional) An array of strings. Each string is a full character description (name and any physical/visual details) for consistent image generation—same format as in prepare-story. Only include when the story implies a change: a new character appears (add one description string), or an existing character's appearance changes (include the updated description string). Omit or use [] if nothing changed.

Output only the JSON object, nothing else.`

function parseNextPageResponse(text: string): {
  shortPlot: string
  characterUpdates: string[]
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
        ? rawUpdates.filter((x): x is string => typeof x === "string")
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
    currentPageImageBase64?: string
    currentPageImageMimeType?: string
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
  const currentPageImageBase64 =
    typeof body.currentPageImageBase64 === "string" &&
    body.currentPageImageBase64.trim() !== ""
      ? body.currentPageImageBase64.trim()
      : undefined
  const currentPageImageMimeType =
    typeof body.currentPageImageMimeType === "string" &&
    body.currentPageImageMimeType.trim() !== ""
      ? body.currentPageImageMimeType.trim()
      : undefined
  const hasCurrentPageImage =
    currentPageImageBase64 != null && currentPageImageMimeType != null
  const characters = Array.isArray(body.characters)
    ? (body.characters as unknown[]).filter(
        (x): x is string => typeof x === "string",
      )
    : []

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

    const stylePrefix =
      illustrationStyle !== ""
        ? buildIllustrationStylePrefix(characters, illustrationStyle)
        : buildIllustrationStylePrefix(
            characters,
            DEFAULT_GLOBAL_ILLUSTRATION_STYLE,
          )
    const imagePromptContent = buildIllustrationPrompt(
      stylePrefix,
      result.shortPlot,
    )
    const consistencyInstruction = hasCurrentPageImage
      ? " Keep characters and art style consistent with the illustration in the previous image."
      : ""
    const imagePrompt = `Create a single children's storybook illustration for this page. No text or words in the image.${consistencyInstruction} ${imagePromptContent}`

    let nextCoverImageBase64: string | undefined
    let nextCoverImageMimeType: string | undefined
    try {
      const imageContents = hasCurrentPageImage
        ? [
            {
              role: "user" as const,
              parts: [
                {
                  inlineData: {
                    data: currentPageImageBase64,
                    mimeType: currentPageImageMimeType ?? "image/png",
                  },
                },
                { text: imagePrompt },
              ],
            },
          ]
        : imagePrompt
      const imageResponse = await client.models.generateContent({
        model: IMAGE_MODEL,
        contents: imageContents,
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
