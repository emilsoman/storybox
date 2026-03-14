import { type RouteConfig, index, route } from "@react-router/dev/routes"

export default [
  index("routes/home.tsx"),
  route("api/gemini-token", "routes/api.gemini-token.tsx"),
  route("api/story-setup", "routes/api.story-setup.tsx"),
  route("api/prepare-story", "routes/api.prepare-story.tsx"),
  route("api/prepare-next-page", "routes/api.prepare-next-page.tsx"),
] satisfies RouteConfig
