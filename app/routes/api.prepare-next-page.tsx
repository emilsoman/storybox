import {
  buildIllustrationStylePrefix,
  DEFAULT_GLOBAL_ILLUSTRATION_STYLE,
} from "~/lib/gemini-live.types"

type ActionArgs = { request: Request }

const MODEL = "gemini-2.5-flash-image"

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

  const stylePrefix = buildIllustrationStylePrefix(
    characters,
    illustrationStyle || DEFAULT_GLOBAL_ILLUSTRATION_STYLE,
  )
  const consistencyInstruction = hasCurrentPageImage
    ? " Keep characters and art style consistent with the illustration in the previous image."
    : ""

  const prompt = `You are preparing the next page of a kids' storybook.

Previous page plot: ${currentShortPlot || "(None)"}${transcript ? `\n\nConversation so far:\n${transcript}` : ""}

Step 1 — Output a JSON object (no markdown, no code fence) with:
- "shortPlot": 2-4 sentence summary for the NEXT page, progressing naturally from the previous
- "characterUpdates": array of full character descriptions (name + visual details) for new or visually changed characters only, or []

Step 2 — Generate a single children's storybook illustration for the next page based on your shortPlot. Style: ${stylePrefix}. No text or words in the image.${consistencyInstruction}`

  console.log("prepare-next-page prompt:", prompt)

  const { GoogleGenAI } = await import("@google/genai")
  const client = new GoogleGenAI({ apiKey: apiKey.trim() })

  try {
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
      model: MODEL,
      contents: [{ role: "user", parts: userParts }],
      config: { responseModalities: ["TEXT", "IMAGE"] },
    })

    type Part = {
      text?: string
      inlineData?: { data?: string; mimeType?: string }
    }
    const parts =
      (response as { candidates?: [{ content?: { parts?: Part[] } }] })
        .candidates?.[0]?.content?.parts ?? []

    let shortPlot = ""
    let characterUpdates: string[] = []
    let nextCoverImageBase64: string | undefined
    let nextCoverImageMimeType: string | undefined

    for (const part of parts) {
      if (part.text && !shortPlot) {
        const jsonMatch = part.text.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]) as unknown
            if (parsed && typeof parsed === "object" && "shortPlot" in parsed) {
              shortPlot =
                typeof (parsed as { shortPlot: unknown }).shortPlot === "string"
                  ? (parsed as { shortPlot: string }).shortPlot
                  : ""
              const rawUpdates = (parsed as { characterUpdates?: unknown })
                .characterUpdates
              characterUpdates = Array.isArray(rawUpdates)
                ? rawUpdates.filter((x): x is string => typeof x === "string")
                : []
            }
          } catch {
            // not JSON, skip
          }
        }
      } else if (part.inlineData?.data && !nextCoverImageBase64) {
        nextCoverImageBase64 = part.inlineData.data
        nextCoverImageMimeType = part.inlineData.mimeType ?? "image/png"
      }
    }

    if (nextCoverImageBase64) {
      console.log(
        "Next page cover image generated. Mime type:",
        nextCoverImageMimeType ?? "image/png",
      )
    }

    return Response.json({
      nextShortPlot: shortPlot,
      ...(characterUpdates.length > 0 && { characterUpdates }),
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
