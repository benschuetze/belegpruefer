import { and, eq, gte, lt } from "drizzle-orm";
import type { Db } from "~/lib/db/client";
import { loginAttempts } from "~/lib/db/schema";

export const WINDOW_MS = 15 * 60 * 1000;
export const MAX_PER_IP = 5;

/**
 * Records the attempt first and counts afterwards, so parallel requests cannot all pass the check before any of
 * them is written: each one counts at least everything inserted before it. Per IP only: a global limit would let
 * anyone lock the owner out with 30 wrong guesses from anywhere.
 */
export async function takeLoginAttempt(db: Db, ipHash: string, now = new Date()): Promise<boolean> {
  await db.insert(loginAttempts).values({ ipHash, attemptedAt: now });
  const since = new Date(now.getTime() - WINDOW_MS);
  const recent = await db.$count(
    loginAttempts,
    and(eq(loginAttempts.ipHash, ipHash), gte(loginAttempts.attemptedAt, since)),
  );
  await db.delete(loginAttempts).where(lt(loginAttempts.attemptedAt, new Date(now.getTime() - 24 * 60 * 60 * 1000)));
  return recent <= MAX_PER_IP;
}

export async function clearLoginAttempts(db: Db, ipHash: string): Promise<void> {
  await db.delete(loginAttempts).where(eq(loginAttempts.ipHash, ipHash));
}
