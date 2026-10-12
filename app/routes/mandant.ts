import { z } from "zod";
import { switchTenant } from "~/lib/auth.server";
import { getDb } from "~/lib/db/client";
import type { Route } from "./+types/mandant";

const form = z.object({ tenantId: z.uuid(), next: z.string().max(200).default("/") });

export async function action({ request }: Route.ActionArgs) {
  const parsed = form.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) throw new Response("Ungültige Auswahl.", { status: 400 });
  return switchTenant(getDb(), request, parsed.data.tenantId, parsed.data.next);
}

export function loader() {
  throw new Response("Nicht gefunden", { status: 404 });
}
