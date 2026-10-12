import { describe, expect, it } from "vitest";
import { makeBeleg } from "../../tests/helpers/belege";
import { AGREE, fixedModel, NO_RESEARCH } from "../../tests/helpers/models";
import type { Example } from "./agents/kontierer";
import type { AgentModels } from "./agents/models";
import { MAX_RESEARCH_STEPS } from "./agents/recherche";
import { FULL_TEAM, plannedCalls, runTeam, type Team } from "./team";

const beleg = makeBeleg();
const BOOKING = { zeilen: [{ satz: 19, konto: "4930", buSchluessel: "9" }], konfidenz: 0.9, begruendung: "Papier" };
const PROFILE = { verkauft: "Papier", land: "DE", ustIdGueltig: true, zusammenfassung: "Händler" };
const HISTORY: Example[] = [
  { lieferant: "Papierwerk Sommer KG", positionen: ["Papier"], konto: "4930", buSchluessel: "9" },
];

function counting(kontierer: unknown = BOOKING) {
  const seen = { kontierer: [] as string[], pruefer: [] as string[], recherche: [] as string[] };
  const models: AgentModels = {
    kontierer: fixedModel("k", kontierer, seen.kontierer),
    pruefer: fixedModel("p", AGREE, seen.pruefer),
    recherche: fixedModel("r", PROFILE, seen.recherche),
    extraktor: fixedModel("e", {}),
  };
  return { seen, models };
}

const run = (models: AgentModels, team: Team, history: Example[] = []) =>
  runTeam({
    models,
    beleg,
    tenantName: "Feldbach Design GmbH",
    history,
    knownProfile: null,
    team,
    research: NO_RESEARCH,
  });

describe("runTeam: Aufstellungen fürs Eval", () => {
  it("Kontierer allein: kein Prüfer-Aufruf, pruefer bleibt undefined", async () => {
    const { seen, models } = counting();
    const result = await run(models, { pruefer: false, recherche: false, examples: false });
    expect(seen.kontierer).toHaveLength(1);
    expect(seen.pruefer).toHaveLength(0);
    expect(result.pruefer).toBeUndefined();
  });

  it("Kontierer ohne verwertbare Antwort: Prüfer wird nicht gefragt, pruefer ist null", async () => {
    const { seen, models } = counting("{kaputt");
    const result = await run(models, FULL_TEAM, HISTORY);
    expect(result.kontierer).toBeNull();
    expect(result.pruefer).toBeNull();
    expect(seen.pruefer).toHaveLength(0);
  });

  it("Recherche nur bei unbekanntem Lieferanten", async () => {
    const unknown = counting();
    expect((await run(unknown.models, FULL_TEAM)).researched).toBe(true);
    expect(unknown.seen.recherche.length).toBeGreaterThan(0);
    const known = counting();
    expect((await run(known.models, FULL_TEAM, HISTORY)).researched).toBe(false);
    expect(known.seen.recherche).toHaveLength(0);
  });

  it("Beispiele nur mit examples: true", async () => {
    const without = counting();
    await run(without.models, { ...FULL_TEAM, examples: false }, HISTORY);
    expect(without.seen.kontierer.join()).not.toContain("<beispiele>\\n");
    const withExamples = counting();
    await run(withExamples.models, FULL_TEAM, HISTORY);
    expect(withExamples.seen.kontierer.join()).toContain("<beispiele>\\n");
  });

  it("plannedCalls ist eine obere Grenze der tatsächlichen Aufrufe", async () => {
    const { seen, models } = counting();
    await run(models, FULL_TEAM);
    const made = seen.kontierer.length + seen.pruefer.length + seen.recherche.length;
    expect(made).toBeLessThanOrEqual(plannedCalls(FULL_TEAM, true));
    expect(plannedCalls(FULL_TEAM, true)).toBe(2 + MAX_RESEARCH_STEPS);
    expect(plannedCalls(FULL_TEAM, false)).toBe(2);
    expect(plannedCalls({ pruefer: false, recherche: false, examples: false }, true)).toBe(1);
  });
});
