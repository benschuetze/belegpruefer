import { data, redirect } from "react-router";
import { z } from "zod";
import { currentTenant, safeRedirect } from "~/lib/auth.server";
import { getDb } from "~/lib/db/client";
import { queueLength } from "~/lib/process.server";
import { processQueue } from "~/lib/run.server";
import { safeError } from "~/lib/security.server";
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
  let result: { processed: number; waiting: number; error?: string };
  try {
    result = await processQueue(db, tenant.id);
  } catch (error) {
    // Returned, not thrown: the page keeps its content and the poller tries again later, instead of the error page
    // replacing everything. Each document's own failures already end in "fehler"; this is the database or similar.
    console.error(`Warteschlange: ${safeError(error)}`);
    result = { processed: 0, waiting: await queueLength(db, tenant.id).catch(() => 0), error: "unterbrochen" };
  }
  if (parsed.data.zurueck) throw redirect(safeRedirect(parsed.data.zurueck));
  return result.error ? data(result, { status: 503 }) : result;
}

export function loader() {
  throw new Response("Nicht gefunden", { status: 404 });
}
