import { logOut } from "~/lib/auth.server";
import type { Route } from "./+types/logout";

export function action({ request }: Route.ActionArgs) {
  return logOut(request);
}

export function loader() {
  throw new Response("Nicht gefunden", { status: 404 });
}
