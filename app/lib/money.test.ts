import { describe, expect, it } from "vitest";
import { formatCents, formatDatevAmount, parseDecimalCents, parseGermanAmount, taxOf } from "./money";

describe("parseGermanAmount", () => {
  it.each([
    ["-1.234,56", -123456],
    ["1.234,56", 123456],
    ["3.612,40", 361240],
    ["-0,99", -99],
    ["259,00", 25900],
    ["12", 1200],
    ["-8,4", -840],
    ["+15,00", 1500],
    ["1.000.000,01", 100000001],
    ["  -21,90 ", -2190],
    ["-21,90 €", -2190],
  ])("%s → %i Cent", (input, cents) => {
    expect(parseGermanAmount(input)).toBe(cents);
  });

  it("rechnet ohne Float-Fehler: 0,10 + 0,20 ist genau 30 Cent", () => {
    expect(parseGermanAmount("0,10") + parseGermanAmount("0,20")).toBe(30);
  });

  it.each(["abc", "", "1,234.56", "12,345", "1.23,45", "--5,00", "5,00-"])("lehnt %j ab", (input) => {
    expect(() => parseGermanAmount(input)).toThrow(/Ungültiger Betrag/);
  });
});

describe("formatCents", () => {
  it.each([
    [123456, "1.234,56 €"],
    [-123456, "−1.234,56 €"],
    [5, "0,05 €"],
    [0, "0,00 €"],
    [100000001, "1.000.000,01 €"],
  ])("%i → %s", (cents, text) => {
    expect(formatCents(cents)).toBe(text);
  });

  it("Formatieren und Parsen ergeben wieder denselben Betrag", () => {
    for (const cents of [-123456, -1, 0, 7, 99, 100, 361240]) {
      expect(parseGermanAmount(formatCents(cents).replace("−", "-"))).toBe(cents);
    }
  });
});

describe("parseDecimalCents (Beträge aus XML)", () => {
  it.each([
    ["119.00", 11900],
    ["119", 11900],
    ["0.5", 50],
    ["-5.50", -550],
    [" 1234.56 ", 123456],
  ])("%s → %i Cent", (input, cents) => {
    expect(parseDecimalCents(input)).toBe(cents);
  });

  it.each(["10.005", "1,50", "", "abc", "1.2.3"])("lehnt %j ab statt zu runden", (input) => {
    expect(() => parseDecimalCents(input)).toThrow(/Ungültiger Betrag/);
  });
});

describe("taxOf", () => {
  it.each([
    [10000, 19, 1900],
    [1050, 7, 74], // 73,5 → 74
    [1, 19, 0],
    [3, 19, 1], // 0,57 → 1
    [-1050, 7, -74],
    [41933, 19, 7967], // 7967,27
  ])("%i Cent zu %i %% → %i Cent Steuer", (net, rate, tax) => {
    expect(taxOf(net, rate)).toBe(tax);
  });
});

describe("formatDatevAmount", () => {
  it.each([
    [123456, "1234,56"],
    [-123456, "1234,56"],
    [5, "0,05"],
    [100000, "1000,00"],
  ])("%i → %s (ohne Tausenderpunkt, ohne Vorzeichen)", (cents, text) => {
    expect(formatDatevAmount(cents)).toBe(text);
  });
});
