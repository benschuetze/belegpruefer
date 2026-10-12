import { currentTenant } from "~/lib/auth.server";
import { getDb } from "~/lib/db/client";
import { documentFile } from "~/lib/queries.server";
import type { Route } from "./+types/beleg-datei";

/** The original file, always as a download: an uploaded XML or PDF is never rendered inside the app's origin. */
export async function loader({ request, params }: Route.LoaderArgs) {
  const db = getDb();
  const tenant = await currentTenant(db, request);
  const file = await documentFile(db, tenant.id, params.id);
  if (!file?.content) throw new Response("Nicht gefunden", { status: 404 });
  const safeName = file.filename.replace(/[^\w.\-äöüÄÖÜß ]/g, "_");
  return new Response(new Uint8Array(Buffer.from(file.content, "base64")), {
    headers: {
      "Content-Type": file.kind === "pdf" ? "application/pdf" : "application/xml",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
