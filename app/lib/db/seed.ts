import { and, eq, notInArray } from "drizzle-orm";
import type { Db, Tx } from "./client";
import { documents, meta, tenants } from "./schema";

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
 * Set once by the public demo's build, on an empty database (or one it already ran on). Every instance gets the
 * two seed tenants, so their ids alone prove nothing; only this marker says "invented data, open to everyone".
 */
const DEMO_MARKER = { key: "instance_kind", value: "demo" } as const;

export async function markDemoDatabase(db: Db | Tx): Promise<void> {
  await db.insert(meta).values(DEMO_MARKER).onConflictDoNothing();
}

/**
 * Demo mode (no login, resettable) is only ever allowed on a database the demo build claimed, and only while it
 * holds nothing but the invented tenants. DEMO_MODE=true anywhere else is a misconfiguration.
 */
export async function isDemoDatabase(db: Db | Tx): Promise<boolean> {
  const marked = await db.$count(meta, and(eq(meta.key, DEMO_MARKER.key), eq(meta.value, DEMO_MARKER.value)));
  return marked > 0 && (await holdsOnlyDemoTenants(db));
}

/** No tenant and no document outside the invented demo tenants. */
export async function holdsOnlyDemoTenants(db: Db | Tx): Promise<boolean> {
  const demoIds = DEMO_TENANTS.map((t) => t.id);
  const strangers = await db.$count(tenants, notInArray(tenants.id, demoIds));
  const strangeDocs = await db.$count(documents, notInArray(documents.tenantId, demoIds));
  return strangers === 0 && strangeDocs === 0;
}
