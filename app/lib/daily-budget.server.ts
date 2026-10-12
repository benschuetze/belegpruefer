import { sql } from "drizzle-orm";
import type { Db } from "~/lib/db/client";

/**
 * Takes up to `amount` from today's budget for `name` and returns how much was granted (0 when used up).
 * One statement that locks the row: two requests at the same moment cannot both read "4 of 5" and go to 6.
 * Model calls cost real money, so every path that calls the model draws from one of these.
 */
export async function takeFromDailyBudget(
  db: Db,
  name: string,
  amount: number,
  limit: number,
  now = new Date(),
): Promise<number> {
  if (amount <= 0) return 0;
  const key = `${name}_${now.toISOString().slice(0, 10)}`;
  await db.execute(sql`insert into meta (key, value) values (${key}, '0') on conflict (key) do nothing`);
  const result = await db.execute(sql`
    update meta as m set value = least(before.used + ${amount}, ${limit})::text
    from (select key, value::int as used from meta where key = ${key} for update) as before
    where m.key = before.key
    returning before.used as before, m.value::int as after
  `);
  const row = (result as unknown as { rows: { before: number | string; after: number | string }[] }).rows[0];
  return row ? Math.max(0, Number(row.after) - Number(row.before)) : 0;
}
