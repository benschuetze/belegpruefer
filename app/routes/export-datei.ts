import { currentTenant } from "~/lib/auth.server";
import { todayInGermany } from "~/lib/dates";
import { buildBuchungsstapel, exportFilename, sameFiscalYear, toWindows1252 } from "~/lib/datev";
import { getDb } from "~/lib/db/client";
import { bookingsInPeriod } from "~/lib/ledger.server";
import { periodFrom } from "~/lib/period";
import type { Route } from "./+types/export-datei";

export async function loader({ request }: Route.LoaderArgs) {
  const db = getDb();
  const tenant = await currentTenant(db, request);
  const { from, to } = periodFrom(new URL(request.url), todayInGermany());
  const rows = await bookingsInPeriod(db, tenant.id, from, to);
  // Only a closed period leaves the app: what the tax office sees must not change afterwards.
  if (rows.length === 0 || rows.some((r) => !r.lockedAt)) {
    throw new Response("Erst festschreiben, dann exportieren.", { status: 409 });
  }
  if (!sameFiscalYear(from, to, tenant.fiscalYearStartMonth)) {
    throw new Response("Der Zeitraum geht über zwei Wirtschaftsjahre. Bitte getrennt exportieren.", { status: 400 });
  }
  const csv = buildBuchungsstapel(rows, { tenant, from, to, createdAt: new Date() });
  return new Response(new Uint8Array(toWindows1252(csv)), {
    headers: {
      "Content-Type": "text/csv; charset=windows-1252",
      "Content-Disposition": `attachment; filename="${exportFilename(tenant, from, to)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
