import { describe, expect, it } from "vitest";
import { buildBeleg } from "../app/lib/beleg-builder";
import { checklistEntry, hasReviewedEntries } from "./checklist";
import type { EvalCase } from "./types";

const evalCase = (beleg = buildBeleg([{ description: "Flyer", netCents: 10000 }])): EvalCase => ({
  id: "B1",
  kind: "werbung",
  tenant: 0,
  tenantName: "Feldbach Design GmbH",
  beleg,
  expected: { lines: [{ satz: 19, konto: "4600", bu: "9" }], outcome: "automatisch" },
});

describe("Stichprobe zum Prüfen von Hand", () => {
  it("zeigt eine fehlende Rechnungsnummer, damit „pruefen“ nachvollziehbar ist", () => {
    const entry = checklistEntry(
      evalCase(buildBeleg([{ description: "Beratung", netCents: 50000 }], { invoiceNumber: undefined })),
    );
    expect(entry).toContain("Ohne Rechnungsnummer.");
  });

  it("zeigt einen fehlenden oder namenlosen Empfänger", () => {
    const ohne = buildBeleg([{ description: "Taxi", netCents: 2000 }], { invoiceNumber: undefined, buyer: undefined });
    expect(checklistEntry(evalCase(ohne))).toContain("Ohne Rechnungsnummer und Empfänger.");
    expect(checklistEntry(evalCase(buildBeleg([{ description: "Taxi", netCents: 2000 }], { buyer: {} })))).toContain(
      "Ohne Empfänger.",
    );
  });

  it("nennt bei vollständigem Beleg keine Lücke", () => {
    expect(checklistEntry(evalCase())).not.toContain("Ohne");
  });

  it("erkennt eine schon ausgefüllte Liste, damit Neuerzeugen sie nicht löscht", () => {
    expect(hasReviewedEntries("- [ ] **B1** …\n- [x] **B2** …")).toBe(true);
    expect(hasReviewedEntries("- [ ] **B1** …\n  Frage: warum?")).toBe(true);
    expect(hasReviewedEntries("- [ ] **B1** …\n- [ ] **B2** …")).toBe(false);
  });
});
