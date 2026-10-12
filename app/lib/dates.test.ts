import { describe, expect, it } from "vitest";
import { previousMonth, todayInGermany } from "./dates";

describe("Datum", () => {
  it("kurz nach Mitternacht in Deutschland ist schon der neue Tag, obwohl UTC noch den alten hat", () => {
    expect(todayInGermany(new Date("2026-09-30T22:30:00Z"))).toBe("2026-10-01");
    expect(todayInGermany(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
  });

  it("Vormonat inklusive Monatsende und Jahreswechsel", () => {
    expect(previousMonth("2026-10-12")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(previousMonth("2026-03-31")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(previousMonth("2028-03-01")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(previousMonth("2027-01-15")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
});
