import { redirect } from "react-router";
import { z } from "zod";
import { currentTenant, safeRedirect } from "~/lib/auth.server";
import { getDb } from "~/lib/db/client";
import { processQueue } from "~/lib/run.server";
import type { Route } from "./+types/verarbeiten";

const form = z.object({ zurueck: z.string().max(200).optional() });

/**
 * Works off the next few waiting documents of the current tenant. The page calls this again and again while
 * something waits; without JavaScript the button posts here and comes back to the page.
 */
export async function action({ request }: Route.ActionArgs) {
  const parsed = form.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) throw new Response("Ungültige Anfrage.", { status: 400 });
  const db = getDb();
  const tenant = await currentTenant(db, request);
  const result = await processQueue(db, tenant.id);
  if (parsed.data.zurueck) throw redirect(safeRedirect(parsed.data.zurueck));
  return result;
}

export function loader() {
  throw new Response("Nicht gefunden", { status: 404 });
}
