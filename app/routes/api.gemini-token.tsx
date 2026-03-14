import type { Route } from "./+types/api.gemini-token"
import { createEphemeralToken } from "~/lib/create-ephemeral-token.server"

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response(null, { status: 405 })
  }
  try {
    const token = await createEphemeralToken()
    return Response.json({ token })
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create token"
    return Response.json({ error: message }, { status: 500 })
  }
}
