import { describe, expect, it } from "vitest";
import { createTestDb } from "../../tests/helpers/db";
import { takeFromDailyBudget } from "./daily-budget.server";

const day = new Date("2026-10-11T10:00:00Z");

describe("Tagesbudget für KI-Aufrufe", () => {
  it("gibt nur so viel frei, wie heute noch übrig ist, danach nichts mehr", async () => {
    const { db } = await createTestDb({ seeded: false });
    expect(await takeFromDailyBudget(db, "llm_items", 7, 10, day)).toBe(7);
    expect(await takeFromDailyBudget(db, "llm_items", 7, 10, day)).toBe(3);
    expect(await takeFromDailyBudget(db, "llm_items", 1, 10, day)).toBe(0);
  });

  it("gleichzeitige Anfragen überholen das Limit nicht", async () => {
    const { db } = await createTestDb({ seeded: false });
    const granted = await Promise.all(
      Array.from({ length: 20 }, () => takeFromDailyBudget(db, "assistant", 1, 5, day)),
    );
    expect(granted.reduce((a, b) => a + b, 0)).toBe(5);
  });

  it("jeder Tag und jeder Zweck hat sein eigenes Budget", async () => {
    const { db } = await createTestDb({ seeded: false });
    expect(await takeFromDailyBudget(db, "assistant", 5, 5, day)).toBe(5);
    expect(await takeFromDailyBudget(db, "rule_agent", 1, 5, day)).toBe(1);
    expect(await takeFromDailyBudget(db, "assistant", 1, 5, new Date("2026-10-12T10:00:00Z"))).toBe(1);
  });
});
