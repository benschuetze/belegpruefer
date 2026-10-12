/**
 * One tiny real call per agent role that books, so a wrong key, workspace, model id or output format shows up at
 * build time and not on the first upload. Skipped for the mock (demo, tests) and without a key.
 */
import "dotenv/config";
import { runKontierer } from "~/lib/agents/kontierer";
import { getLiveAgentModels } from "~/lib/agents/models";
import { runPruefer } from "~/lib/agents/pruefer";
import { buildBeleg } from "~/lib/beleg-builder";

if (process.env.AI_MOCK === "1" || !process.env.ANTHROPIC_API_KEY) {
  console.log("KI-Selbsttest übersprungen (Mock oder kein Key)");
  process.exit(0);
}
const models = getLiveAgentModels();
const beleg = buildBeleg([{ description: "Kopierpapier A4, 5 Pack", netCents: 2490 }]);
const booked = await runKontierer(models.kontierer, {
  beleg,
  tenantName: "Selbsttest GmbH",
  examples: [],
  profile: null,
});
if (!booked.output) throw new Error(`KI-Selbsttest Kontierer fehlgeschlagen (${booked.model}): ${booked.error}`);
const reviewed = await runPruefer(models.pruefer, {
  beleg,
  proposal: { zeilen: booked.output.zeilen, begruendung: booked.output.begruendung },
});
if (!reviewed.output) throw new Error(`KI-Selbsttest Prüfer fehlgeschlagen (${reviewed.model}): ${reviewed.error}`);
const cost = (booked.costMicrocents + reviewed.costMicrocents) / 1e6;
console.log(
  `KI-Selbsttest bestanden: ${booked.model} → ${booked.output.zeilen.map((z) => z.konto).join(",")} (${booked.output.konfidenz}), ` +
    `${reviewed.model} → ${reviewed.output.urteil}, ${cost.toFixed(4)} ct`,
);
