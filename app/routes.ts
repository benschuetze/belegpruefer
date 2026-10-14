import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("belege", "routes/belege.tsx"),
  route("belege/:id", "routes/beleg.tsx"),
  route("belege/:id/datei", "routes/beleg-datei.ts"),
  route("verarbeiten", "routes/verarbeiten.ts"),
  route("protokoll", "routes/protokoll.tsx"),
  route("export", "routes/export.tsx"),
  route("export/datei", "routes/export-datei.ts"),
  route("eval", "routes/eval.tsx"),
  route("mandant", "routes/mandant.ts"),
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.ts"),
  route("favicon.ico", "routes/favicon.ts"),
] satisfies RouteConfig;
