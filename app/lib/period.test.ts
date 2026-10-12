import { describe, expect, it } from "vitest";
import { periodFrom } from "./period";

const at = (query: string) => periodFrom(new URL(`http://x/export?${query}`), "2026-10-12");

describe("Zeitraum aus der Adresse", () => {
  it("übernimmt einen gültigen Zeitraum", () => {
    expect(at("von=2026-09-01&bis=2026-09-30")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it.each(["von=2026-02-30&bis=2026-02-31", "von=x&bis=y", "von=2026-09-30&bis=2026-09-01", ""])(
    "%s → Vormonat",
    (query) => {
      expect(at(query)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    },
  );
});

it("ein Zeitraum über den Jahreswechsel bleibt erlaubt; ob er in ein Wirtschaftsjahr passt, prüft der Export", () => {
  expect(at("von=2025-12-01&bis=2026-01-31")).toEqual({ from: "2025-12-01", to: "2026-01-31" });
});
