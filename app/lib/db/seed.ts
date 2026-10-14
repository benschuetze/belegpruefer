import { notInArray } from "drizzle-orm";
import type { Db, Tx } from "./client";
import { documents, tenants } from "./schema";

/** Invented companies. Fixed ids so tests, demo data and the tenant switcher can refer to them. */
export const DEMO_TENANTS = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Feldbach Design GmbH",
    beraterNr: 1001,
    mandantenNr: 10001,
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Rösterei Lindgrün UG",
    beraterNr: 1001,
    mandantenNr: 10002,
  },
] as const;

export async function seed(db: Db): Promise<void> {
  await db
    .insert(tenants)
    .values([...DEMO_TENANTS])
    .onConflictDoNothing();
}

/**
 * True while the database holds nothing but the invented demo tenants. Demo mode (open to everyone, resettable)
 * is only ever allowed on such a database; one real client in it and DEMO_MODE=true is a misconfiguration.
 */
export async function holdsOnlyDemoTenants(db: Db | Tx): Promise<boolean> {
  const demoIds = DEMO_TENANTS.map((t) => t.id);
  const strangers = await db.$count(tenants, notInArray(tenants.id, demoIds));
  const strangeDocs = await db.$count(documents, notInArray(documents.tenantId, demoIds));
  return strangers === 0 && strangeDocs === 0;
}
