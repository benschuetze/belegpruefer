import type { Db } from "./client";
import { tenants } from "./schema";

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
