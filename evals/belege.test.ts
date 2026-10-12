import { describe, expect, it } from "vitest";
import { accountByNumber, TAX_KEYS } from "../app/lib/skr03";
import { hasErrors, validateBeleg, validateBooking } from "../app/lib/validator";
import cases from "./belege.json";
import type { EvalCase } from "./types";

const all = cases as EvalCase[];
const TODAY = "2026-10-12";

describe("Eval-Set", () => {
  it("hat mindestens 150 Belege mit eindeutigen IDs", () => {
    expect(all.length).toBeGreaterThanOrEqual(150);
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
  });

  it("jeder Sonderfall aus dem Briefing kommt mehrfach vor", () => {
    const count = (kind: string) => all.filter((c) => c.kind.startsWith(kind)).length;
    for (const kind of [
      "reverse_charge",
      "bewirtung_ohne",
      "gwg",
      "anlage",
      "fachbuch",
      "lebensmittel",
      "bahn",
      "kleinbetrag",
      "software_abo",
      "wartung",
      "fehler_",
      "injection",
    ]) {
      expect(count(kind), kind).toBeGreaterThanOrEqual(2);
    }
  });

  it("erwartete Konten und BU-Schlüssel gibt es, je Steuersatz genau eine Zeile", () => {
    for (const c of all) {
      for (const line of c.expected.lines) {
        expect(accountByNumber(line.konto), `${c.id} ${line.konto}`).toBeDefined();
        expect(Object.keys(TAX_KEYS), c.id).toContain(line.bu);
      }
      const rates = c.beleg.taxGroups.map((g) => g.rate).sort();
      expect(c.expected.lines.map((l) => l.satz).sort(), c.id).toEqual(rates);
    }
  });

  it("Erwartung „automatisch“ nur ohne Validator-Fehler; Fehlerfälle zeigt der Validator selbst", () => {
    for (const c of all) {
      const findings = [
        ...validateBeleg(c.beleg, TODAY),
        ...c.expected.lines.flatMap((l) => validateBooking(c.beleg, l.konto)),
      ];
      if (c.expected.outcome === "automatisch") expect(hasErrors(findings), `${c.id} ${c.kind}`).toBe(false);
      if (
        c.kind.startsWith("fehler_") ||
        c.kind === "bewirtung_ohne_angaben" ||
        c.kind === "reverse_charge_ohne_hinweis"
      ) {
        expect(hasErrors(findings), `${c.id} ${c.kind}`).toBe(true);
      }
    }
  });

  it("enthält keine echten Zahlungsdaten: keine IBAN im Text", () => {
    expect(JSON.stringify(all)).not.toMatch(/\bDE\d{20}\b/);
  });
});
