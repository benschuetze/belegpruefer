import { describe, expect, it } from "vitest";
import { createTestDb } from "../../tests/helpers/db";
import { clearLoginAttempts, MAX_PER_IP, takeLoginAttempt } from "./login-throttle.server";

const now = new Date("2026-10-12T10:00:00Z");

describe("Login-Bremse", () => {
  it("20 gleichzeitige Versuche von einer IP: höchstens 5 kommen zur Passwortprüfung", async () => {
    const { db } = await createTestDb({ seeded: false });
    const allowed = await Promise.all(Array.from({ length: 20 }, () => takeLoginAttempt(db, "ip-a", now)));
    expect(allowed.filter(Boolean).length).toBeLessThanOrEqual(MAX_PER_IP);
  });

  it("viele Fehlversuche von fremden IPs sperren den Inhaber nicht aus", async () => {
    const { db } = await createTestDb({ seeded: false });
    for (let i = 0; i < 40; i++) await takeLoginAttempt(db, `fremd-${i}`, now);
    expect(await takeLoginAttempt(db, "inhaber", now)).toBe(true);
  });

  it("nach 15 Minuten oder erfolgreichem Login ist die IP wieder frei", async () => {
    const { db } = await createTestDb({ seeded: false });
    for (let i = 0; i < 6; i++) await takeLoginAttempt(db, "ip-b", now);
    expect(await takeLoginAttempt(db, "ip-b", now)).toBe(false);
    expect(await takeLoginAttempt(db, "ip-b", new Date(now.getTime() + 16 * 60 * 1000))).toBe(true);
    await clearLoginAttempts(db, "ip-b");
    expect(await takeLoginAttempt(db, "ip-b", now)).toBe(true);
  });
});
