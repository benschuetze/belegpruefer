import "dotenv/config";
import { getDb } from "~/lib/db/client";
import { loadDemoData, resetDemoDataIfOutdated } from "~/lib/db/demo-data";
import { seed } from "~/lib/db/seed";

const db = getDb();
await seed(db);
console.log("Mandanten angelegt");
// The public demo and local development start with invented invoices; a private instance starts empty.
if (process.env.DEMO_MODE === "true" || process.argv.includes("--demo")) {
  // Only the public demo resets itself; its database holds invented tenants and nothing else.
  if (process.env.DEMO_MODE === "true" && (await resetDemoDataIfOutdated(db)))
    console.log("Demo-Daten veraltet, neu geladen");
  console.log(`Demo-Daten: ${await loadDemoData(db)} Belege angelegt`);
}
process.exit(0);
