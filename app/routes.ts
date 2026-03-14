import { type RouteConfig, index, route } from "@react-router/dev/routes"

export default [
  index("routes/home.tsx"),
  route("api/gemini-token", "routes/api.gemini-token.tsx"),
] satisfies RouteConfig
