import {
  buildIllustrationStylePrefix,
  DEFAULT_GLOBAL_ILLUSTRATION_STYLE,
} from "~/lib/gemini-live.types"

type ActionArgs = { request: Request }

const TEXT_MODEL = "gemini-2.0-flash"
const IMAGE_MODEL = "gemini-2.5-flash-image"

export async function action({ request }: ActionArgs) {
  console.log("prepare-next-page", request.method)
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
  const illustrationStyle =
    typeof body.illustrationStyle === "string" && body.illustrationStyle.trim()
      ? body.illustrationStyle.trim()
      : ""
  const currentPageImageBase64 =
    typeof body.currentPageImageBase64 === "string" &&
    body.currentPageImageBase64.trim()
      ? body.currentPageImageBase64.trim()
      : undefined
  const currentPageImageMimeType =
    typeof body.currentPageImageMimeType === "string" &&
    body.currentPageImageMimeType.trim()
      ? body.currentPageImageMimeType.trim()
      : undefined
  const hasCurrentPageImage =
    currentPageImageBase64 != null && currentPageImageMimeType != null
  const characters = Array.isArray(body.characters)
    ? (body.characters as unknown[]).filter(
        (x): x is string => typeof x === "string",
      )
    : []

  // illustrationStyle already has characters baked in (built by the client);
  // only fall back to building it fresh if the client sent the raw base style.
  const stylePrefix =
    illustrationStyle ||
    buildIllustrationStylePrefix(characters, DEFAULT_GLOBAL_ILLUSTRATION_STYLE)
  const consistencyInstruction = hasCurrentPageImage
    ? " Keep characters and art style consistent with the illustration in the previous image."
    : ""

  const { GoogleGenAI } = await import("@google/genai")
  const client = new GoogleGenAI({ apiKey: apiKey.trim() })

  async function generateNextPageJson(): Promise<{
    shortPlot: string
    characterUpdates: string[]
  }> {
    const prompt = `You are preparing the next page of a kids' storybook.

Previous page plot: ${currentShortPlot || "(None)"}${
      transcript ? `\n\nConversation so far:\n${transcript}` : ""
    }

Only perform this step:

Step 1 — Output a JSON object (no markdown, no code fence) with BOTH of these fields:
- "shortPlot": A NON-EMPTY 1–2 sentence summary for the NEXT page while the story is ongoing. Advance the story by exactly ONE brief moment from where the previous page left off. Keep it very short — each page covers only a single small beat. Do not skip ahead or resolve the story prematurely — leave the climax and resolution for later pages. Only output an empty string "" when the app has clearly indicated the story is completely finished.
- "characterUpdates": An array that MUST ALWAYS be present. Use full character descriptions (name + visual details) for new or visually changed characters only. When there are no new or changed characters, set this to an empty array [].

Return ONLY this JSON object in your response.`

    const response = await client.models.generateContent({
      model: TEXT_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { responseModalities: ["TEXT"] },
    })

    type TextPart = { text?: string }
    const parts =
      (response as { candidates?: [{ content?: { parts?: TextPart[] } }] })
        .candidates?.[0]?.content?.parts ?? []

    let shortPlot = ""
    let characterUpdates: string[] = []

    for (const part of parts) {
      if (!part.text) continue
      console.log("prepare-next-page JSON part.text:", part.text)
      const jsonMatch = part.text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) continue
      try {
        const parsed = JSON.parse(jsonMatch[0]) as {
          shortPlot?: unknown
          characterUpdates?: unknown
        }
        const rawShort = parsed.shortPlot ?? ""
        if (typeof rawShort === "string" && rawShort.trim()) {
          shortPlot = rawShort.trim()
        }
        const rawUpdates = parsed.characterUpdates
        characterUpdates = Array.isArray(rawUpdates)
          ? rawUpdates.filter((x): x is string => typeof x === "string")
          : []
        // Once we've successfully parsed, we can stop.
        if (shortPlot) break
      } catch {
        // not JSON, skip
      }
    }

    if (!shortPlot) {
      throw new Error("Model did not return a valid shortPlot JSON object")
    }

    return { shortPlot, characterUpdates }
  }

  async function generateNextPageImage(
    shortPlot: string,
  ): Promise<{
    nextCoverImageBase64?: string
    nextCoverImageMimeType?: string
  }> {
    const prompt = `Generate a single children's storybook illustration for the NEXT page of a kids' storybook.

Next page plot: ${shortPlot}

Style: ${stylePrefix}. No text or words in the image.${consistencyInstruction}`

    const userParts = hasCurrentPageImage
      ? [
          {
            inlineData: {
              data: currentPageImageBase64,
              mimeType: currentPageImageMimeType ?? "image/png",
            },
          },
          { text: prompt },
        ]
      : [{ text: prompt }]

    const response = await client.models.generateContent({
      model: IMAGE_MODEL,
      contents: [{ role: "user", parts: userParts }],
      config: { responseModalities: ["IMAGE"] },
    })

    type ImagePart = { inlineData?: { data?: string; mimeType?: string } }
    const parts =
      (response as { candidates?: [{ content?: { parts?: ImagePart[] } }] })
        .candidates?.[0]?.content?.parts ?? []

    let nextCoverImageBase64: string | undefined
    let nextCoverImageMimeType: string | undefined

    for (const part of parts) {
      if (part.inlineData?.data) {
        nextCoverImageBase64 = part.inlineData.data
        nextCoverImageMimeType = part.inlineData.mimeType ?? "image/png"
        break
      }
    }

    return { nextCoverImageBase64, nextCoverImageMimeType }
  }

  try {
    // First, get the next page JSON (shortPlot + characterUpdates)
    const { shortPlot, characterUpdates } = await generateNextPageJson()

    // Then, independently try to get an image for that plot. If it fails, we
    // still advance the story with text-only content.
    let nextCoverImageBase64: string | undefined
    let nextCoverImageMimeType: string | undefined
    try {
      const imageResult = await generateNextPageImage(shortPlot)
      nextCoverImageBase64 = imageResult.nextCoverImageBase64
      nextCoverImageMimeType = imageResult.nextCoverImageMimeType
    } catch (imageErr) {
      console.warn(
        "prepare-next-page: image generation failed for valid shortPlot",
        imageErr,
      )
    }

    if (nextCoverImageBase64) {
      console.log(
        "Next page cover image generated. Mime type:",
        nextCoverImageMimeType ?? "image/png",
      )
    } else {
      console.warn("Next page shortPlot ready but image is missing.")
    }

    return Response.json({
      nextShortPlot: shortPlot,
      characterUpdates,
      ...(nextCoverImageBase64 && {
        nextCoverImageBase64,
        nextCoverImageMimeType: nextCoverImageMimeType ?? "image/png",
      }),
      ...(!nextCoverImageBase64 && { imageMissing: true }),
    })
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to prepare next page"
    return Response.json({ error: message }, { status: 500 })
  }
}
