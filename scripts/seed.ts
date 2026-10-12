import "dotenv/config";
import { getDb } from "~/lib/db/client";
import { loadDemoData } from "~/lib/db/demo-data";
import { seed } from "~/lib/db/seed";

const db = getDb();
await seed(db);
console.log("Mandanten angelegt");
// The public demo and local development start with invented invoices; a private instance starts empty.
if (process.env.DEMO_MODE === "true" || process.argv.includes("--demo")) {
  console.log(`Demo-Daten: ${await loadDemoData(db)} Belege angelegt`);
}
process.exit(0);
