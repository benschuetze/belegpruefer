import { and, eq, gte, lt } from "drizzle-orm";
import type { Db } from "~/lib/db/client";
import { loginAttempts } from "~/lib/db/schema";

export const WINDOW_MS = 15 * 60 * 1000;
export const MAX_PER_IP = 5;
/** Across all IPs, against guessing from many addresses at once. One user means legitimate failures are rare. */
export const MAX_GLOBAL = 30;

export async function isLoginBlocked(db: Db, ipHash: string, now = new Date()): Promise<boolean> {
  const since = new Date(now.getTime() - WINDOW_MS);
  const [fromIp, overall] = await Promise.all([
    db.$count(loginAttempts, and(eq(loginAttempts.ipHash, ipHash), gte(loginAttempts.attemptedAt, since))),
    db.$count(loginAttempts, gte(loginAttempts.attemptedAt, since)),
  ]);
  return fromIp >= MAX_PER_IP || overall >= MAX_GLOBAL;
}

export async function recordFailedLogin(db: Db, ipHash: string, now = new Date()): Promise<void> {
  await db.insert(loginAttempts).values({ ipHash, attemptedAt: now });
  await db.delete(loginAttempts).where(lt(loginAttempts.attemptedAt, new Date(now.getTime() - 24 * 60 * 60 * 1000)));
}

export async function clearFailedLogins(db: Db, ipHash: string): Promise<void> {
  await db.delete(loginAttempts).where(eq(loginAttempts.ipHash, ipHash));
}
