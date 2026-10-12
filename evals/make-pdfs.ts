/**
 * Renders 20 eval invoices as PDF (HTML → Chromium) into evals/pdfs/, with the expected fields next to them.
 * Three layouts, so the extractor does not just learn one template. Invented companies only.
 *
 *   pnpm tsx evals/make-pdfs.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import type { Beleg } from "../app/lib/beleg";
import cases from "./belege.json";
import type { EvalCase } from "./types";

const all = cases as EvalCase[];
const OUT = new URL("./pdfs/", import.meta.url);

/** One of each interesting kind first, then fill up to 20. */
function choose(): EvalCase[] {
  const wanted = [
    "buero",
    "hotel_gemischt",
    "reverse_charge_werbung",
    "reverse_charge_software",
    "bewirtung_vollstaendig",
    "bewirtung_ohne_angaben",
    "anlage",
    "gwg",
    "fachbuch",
    "kleinbetrag",
    "versicherung",
    "fehler_summe",
    "fehler_ust_id",
    "injection",
    "wareneingang_7",
    "software_abo",
    "wartung",
    "bahn",
    "beratung",
    "telefon",
  ];
  return wanted.map((kind) => all.find((c) => c.kind === kind)).filter((c): c is EvalCase => Boolean(c));
}

const euro = (cents: number) =>
  `${(cents / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const date = (iso?: string) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "");
const esc = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function html(b: Beleg, layout: number): string {
  const s = b.supplier;
  const address = [
    s.street,
    [s.postcode, s.city].filter(Boolean).join(" "),
    s.country && s.country !== "DE" ? s.country : "",
  ]
    .filter(Boolean)
    .join("<br>");
  const lines = b.lines
    .map(
      (l, i) =>
        `<tr><td>${i + 1}</td><td>${esc(l.description)}</td><td class="r">${l.quantity ?? 1}</td><td class="r">${l.taxRate} %</td><td class="r">${euro(l.netCents)}</td></tr>`,
    )
    .join("");
  const taxes = b.taxGroups
    .map(
      (g) =>
        `<tr><td colspan="4" class="r">USt ${g.rate} % auf ${euro(g.netCents)}</td><td class="r">${euro(g.taxCents)}</td></tr>`,
    )
    .join("");
  const meta = [
    b.invoiceNumber ? `Rechnungsnummer: ${esc(b.invoiceNumber)}` : "",
    b.issueDate ? `Rechnungsdatum: ${date(b.issueDate)}` : "",
    b.deliveryDate ? `Leistungsdatum: ${date(b.deliveryDate)}` : "",
  ]
    .filter(Boolean)
    .join("<br>");
  const ids = [s.vatId ? `USt-IdNr.: ${s.vatId}` : "", s.taxNumber ? `Steuernummer: ${s.taxNumber}` : ""]
    .filter(Boolean)
    .join(" · ");
  const fonts = ["Helvetica, Arial, sans-serif", "Georgia, serif", "Courier New, monospace"];
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
    body { font-family: ${fonts[layout]}; font-size: 11pt; margin: 18mm; color: #111; }
    h1 { font-size: ${layout === 1 ? 22 : 16}pt; margin: 0 0 6mm; }
    .head { display: flex; justify-content: space-between; ${layout === 2 ? "flex-direction: row-reverse;" : ""} }
    table { width: 100%; border-collapse: collapse; margin-top: 8mm; }
    td, th { padding: 1.5mm 2mm; border-bottom: 1px solid #ccc; text-align: left; vertical-align: top; }
    .r { text-align: right; } .total td { font-weight: bold; border-top: 2px solid #111; }
    .notes { margin-top: 8mm; font-size: 10pt; } .foot { margin-top: 14mm; font-size: 9pt; color: #444; }
  </style></head><body>
    <div class="head">
      <div><strong>${esc(s.name)}</strong><br>${address}</div>
      <div>${b.buyer?.name ? `An:<br>${esc(b.buyer.name)}${b.buyer.vatId ? `<br>USt-IdNr.: ${b.buyer.vatId}` : ""}` : ""}</div>
    </div>
    <h1>${layout === 1 ? "RECHNUNG" : "Rechnung"}</h1>
    <div>${meta}</div>
    <table><thead><tr><th>Pos.</th><th>Beschreibung</th><th class="r">Menge</th><th class="r">USt</th><th class="r">Netto</th></tr></thead>
      <tbody>${lines}
        <tr><td colspan="4" class="r">Summe netto</td><td class="r">${euro(b.totals.netCents)}</td></tr>
        ${taxes}
        <tr class="total"><td colspan="4" class="r">Gesamtbetrag</td><td class="r">${euro(b.totals.grossCents)}</td></tr>
      </tbody></table>
    ${b.notes.length ? `<div class="notes">${b.notes.map(esc).join("<br>")}</div>` : ""}
    <div class="foot">${ids}${ids ? " · " : ""}Zahlbar innerhalb von 14 Tagen. Erfundene Rechnung für Testzwecke.</div>
  </body></html>`;
}

mkdirSync(OUT, { recursive: true });
const chosen = choose();
const browser = await chromium.launch();
const page = await browser.newPage();
const expected: Record<string, Beleg & { kind: string }> = {};
for (const [i, c] of chosen.entries()) {
  await page.setContent(html(c.beleg, i % 3));
  await page.pdf({ path: new URL(`./${c.id}.pdf`, OUT).pathname, format: "A4" });
  expected[c.id] = { ...c.beleg, kind: c.kind };
}
await browser.close();
writeFileSync(new URL("./erwartet.json", OUT), `${JSON.stringify(expected, null, 1)}\n`);
console.log(`${chosen.length} PDFs geschrieben`);
