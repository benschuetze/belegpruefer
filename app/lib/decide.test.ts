import { describe, expect, it } from "vitest";
import { makeBeleg, makeReverseCharge } from "../../tests/helpers/belege";
import type { KontiererOutput } from "./agents/kontierer";
import type { Finding } from "./db/schema";
import { decide } from "./decide";

const paper = makeBeleg();
const proposal = (konto: string, buSchluessel: string, konfidenz = 0.95, satz = 19): KontiererOutput =>
  ({ zeilen: [{ satz, konto, buSchluessel }], konfidenz, begruendung: "Büromaterial" }) as KontiererOutput;
const agree = { urteil: "einverstanden" as const, begruendung: "passt" };

describe("Entscheidung: automatisch nur, wenn alles passt", () => {
  it("einig, sicher, ohne Befund → automatisch", () => {
    expect(decide({ beleg: paper, findings: [], kontierer: proposal("4930", "9"), pruefer: agree }).outcome).toBe(
      "automatisch",
    );
  });

  it("ohne Prüfer (Variante Kontierer allein) reicht die Konfidenz", () => {
    expect(decide({ beleg: paper, findings: [], kontierer: proposal("4930", "9") }).outcome).toBe("automatisch");
  });

  it("Validator-Fehler → prüfen, ein bloßer Hinweis nicht", () => {
    const error: Finding = { code: "summe_brutto", severity: "fehler", message: "x" };
    const note: Finding = { code: "leistungsdatum", severity: "hinweis", message: "x" };
    expect(decide({ beleg: paper, findings: [error], kontierer: proposal("4930", "9"), pruefer: agree }).outcome).toBe(
      "pruefen",
    );
    expect(decide({ beleg: paper, findings: [note], kontierer: proposal("4930", "9"), pruefer: agree }).outcome).toBe(
      "automatisch",
    );
  });

  it("Einwand des Prüfers → prüfen", () => {
    const result = decide({
      beleg: paper,
      findings: [],
      kontierer: proposal("4930", "9"),
      pruefer: { urteil: "einwand", begruendung: "Das ist ein Fachbuch" },
    });
    expect(result.outcome).toBe("pruefen");
    expect(result.reasons).toContain("Der Prüfer hat einen Einwand.");
  });

  it("Prüfer gefragt, aber ohne Antwort → prüfen, nicht still automatisch", () => {
    expect(decide({ beleg: paper, findings: [], kontierer: proposal("4930", "9"), pruefer: null }).outcome).toBe(
      "pruefen",
    );
  });

  it("kaputte Antwort des Kontierers → prüfen", () => {
    expect(decide({ beleg: paper, findings: [], kontierer: null, pruefer: agree }).outcome).toBe("pruefen");
  });

  it("Schwelle 0,8: 0,79 prüfen, 0,80 automatisch", () => {
    expect(decide({ beleg: paper, findings: [], kontierer: proposal("4930", "9", 0.79) }).outcome).toBe("pruefen");
    expect(decide({ beleg: paper, findings: [], kontierer: proposal("4930", "9", 0.8) }).outcome).toBe("automatisch");
  });
});

describe("Risikokonten brauchen 0,9", () => {
  it("Bewirtung mit vollständigen Angaben: 0,85 prüfen, 0,9 automatisch", () => {
    const meal = makeBeleg([{ description: "Mittagessen", netCents: 8400 }], {
      notes: ["Anlass: Projektbesprechung", "Teilnehmer: A. Feld, K. Brandt"],
    });
    expect(decide({ beleg: meal, findings: [], kontierer: proposal("4650", "9", 0.85) }).outcome).toBe("pruefen");
    expect(decide({ beleg: meal, findings: [], kontierer: proposal("4650", "9", 0.9) }).outcome).toBe("automatisch");
  });

  it("Bewirtung ohne Anlass und Teilnehmer → prüfen, egal wie sicher", () => {
    const meal = makeBeleg([{ description: "Mittagessen", netCents: 8400 }]);
    const result = decide({ beleg: meal, findings: [], kontierer: proposal("4650", "9", 0.99) });
    expect(result.outcome).toBe("pruefen");
    expect(result.bookingFindings.map((f) => f.code)).toEqual(["bewirtung_angaben"]);
  });

  it("Reverse Charge mit BU 46 ist Risiko, ab 0,9 automatisch", () => {
    const rc = makeReverseCharge();
    expect(decide({ beleg: rc, findings: [], kontierer: proposal("4600", "46", 0.88, 0) }).outcome).toBe("pruefen");
    expect(decide({ beleg: rc, findings: [], kontierer: proposal("4600", "46", 0.93, 0) }).outcome).toBe("automatisch");
  });

  it("Laptop als Anlage wird nie automatisch gebucht", () => {
    const laptop = makeBeleg([{ description: "Laptop", netCents: 140000 }]);
    expect(decide({ beleg: laptop, findings: [], kontierer: proposal("0420", "9", 1), pruefer: agree }).outcome).toBe(
      "pruefen",
    );
  });
});

describe("Steuerschlüssel prüft der Code, nicht das Modell", () => {
  it("BU 8 bei 19 % → prüfen", () => {
    expect(decide({ beleg: paper, findings: [], kontierer: proposal("4930", "8", 0.99) }).outcome).toBe("pruefen");
  });

  it("BU 46 bei einem deutschen Lieferanten → prüfen", () => {
    const zero = makeBeleg([{ description: "Versicherungsbeitrag", netCents: 30000, taxRate: 0 }]);
    expect(decide({ beleg: zero, findings: [], kontierer: proposal("4360", "46", 0.99, 0) }).outcome).toBe("pruefen");
    expect(decide({ beleg: zero, findings: [], kontierer: proposal("4360", "", 0.99, 0) }).outcome).toBe("automatisch");
  });

  it("gemischte Sätze brauchen eine Zeile je Satz", () => {
    const mixed = makeBeleg([
      { description: "Papier", netCents: 1000 },
      { description: "Fachbuch", netCents: 2000, taxRate: 7 },
    ]);
    expect(decide({ beleg: mixed, findings: [], kontierer: proposal("4930", "9", 0.99) }).outcome).toBe("pruefen");
    const both = {
      zeilen: [
        { satz: 19, konto: "4930", buSchluessel: "9" },
        { satz: 7, konto: "4940", buSchluessel: "8" },
      ],
      konfidenz: 0.95,
      begruendung: "",
    } as KontiererOutput;
    expect(decide({ beleg: mixed, findings: [], kontierer: both }).outcome).toBe("automatisch");
  });
});
