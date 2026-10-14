import "dotenv/config";
import { createDb } from "~/lib/db/client";
import { loadDemoData, markDemoDataLoaded, resetDemoDataIfOutdated } from "~/lib/db/demo-data";
import { seed } from "~/lib/db/seed";

// Owner: creating tenants and the demo reset are beyond the runtime role, on purpose.
const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!url) throw new Error("MIGRATION_DATABASE_URL oder DATABASE_URL fehlt");
const db = createDb(url);
await seed(db);
console.log("Mandanten angelegt");
// The public demo and local development start with invented invoices; a private instance starts empty.
if (process.env.DEMO_MODE === "true" || process.argv.includes("--demo")) {
  // Only the public demo resets itself, and only while its database holds nothing but the invented tenants.
  const isPublicDemo = process.env.DEMO_MODE === "true";
  if (isPublicDemo && (await resetDemoDataIfOutdated(db))) console.log("Demo-Daten veraltet, werden neu geladen");
  console.log(`Demo-Daten: ${await loadDemoData(db)} Belege angelegt`);
  if (isPublicDemo) await markDemoDataLoaded(db);
}
process.exit(0);
