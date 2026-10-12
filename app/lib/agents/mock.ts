import { MockLanguageModelV4 } from "ai/test";
import type { AgentModels } from "./models";

/**
 * Deterministic stand-ins for E2E runs and the public demo: a keyword table instead of a model. Good enough to show
 * every path (automatic, objection, low confidence, injection) without spending credits; never used by `pnpm eval`.
 */
const KEYWORDS: [RegExp, string, number][] = [
  [/laptop|notebook/i, "0420", 0.9],
  [/bürostuhl|regal|schreibtischleuchte|aktenschrank/i, "4855", 0.92],
  [/menü|restaurant|bewirtung|catering|mittagessen|abendessen/i, "4650", 0.86],
  [/sponsored|anzeige|kampagne|werbung|flyer|plakat|ads\b/i, "4600", 0.93],
  [/fachbuch|zeitschrift|abonnement zeitung/i, "4940", 0.94],
  [/lizenz|abo|subscription|saas|cloud/i, "4964", 0.9],
  [/röster|maschine/i, "4800", 0.86],
  [/wartung|support|reparatur/i, "4806", 0.87],
  [/mobilfunk|telefon/i, "4920", 0.93],
  [/internet|dsl|glasfaser|hosting/i, "4925", 0.92],
  // Both demo tenants are corporations: travel goes to 4660 (employees), not 4670.
  [/bahn|ticket|hotel|übernachtung|flug|taxi/i, "4660", 0.9],
  [/miete/i, "4210", 0.95],
  [/versicherung/i, "4360", 0.95],
  [/buchführung|lohnbuchhaltung/i, "4955", 0.86],
  [/jahresabschluss/i, "4957", 0.86],
  [/steuerberatung|rechtsanwalt|beratung/i, "4950", 0.85],
  [/kontoführung|gebühr/i, "4970", 0.9],
  [/rohkaffee|kaffeetüten|verpackung|zum weiterverkauf/i, "3400", 0.9],
  [/papier|stifte|ordner|toner|büromaterial|kaffee|milch/i, "4930", 0.92],
];

type PromptBeleg = {
  lieferant: { land: string | null };
  positionen: { text: string; steuersatz: number }[];
  steuergruppen: { satz: number; kategorie: string | null }[];
  hinweise: string[];
};

function promptText(prompt: { role: string; content: unknown }[]): string {
  return prompt
    .filter((m) => m.role === "user")
    .map((m) =>
      typeof m.content === "string"
        ? m.content
        : (m.content as { type: string; text?: string }[])
            .map((p) => (p.type === "text" ? (p.text ?? "") : ""))
            .join(""),
    )
    .join("\n");
}

function tagged<T>(text: string, tag: string): T | null {
  const match = new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`).exec(text);
  return match?.[1] ? (JSON.parse(match[1]) as T) : null;
}

function taxKey(rate: number, beleg: PromptBeleg): string {
  if (rate === 19) return "9";
  if (rate === 7) return "8";
  const reverseCharge = beleg.steuergruppen.some((g) => g.kategorie === "AE");
  return reverseCharge ? "46" : "";
}

function propose(beleg: PromptBeleg) {
  const allText = beleg.positionen.map((p) => p.text).join(" ");
  const injected = /ignoriere|ignore (all|previous)|konfidenz 1/i.test(`${allText} ${beleg.hinweise.join(" ")}`);
  const zeilen = beleg.steuergruppen.map((g) => {
    const text = beleg.positionen
      .filter((p) => p.steuersatz === g.satz)
      .map((p) => p.text)
      .join(" ");
    const hit = KEYWORDS.find(([re]) => re.test(text));
    // Goods for resale at 7 % go to their own purchase account.
    const konto = hit?.[1] === "3400" && g.satz === 7 ? "3300" : (hit?.[1] ?? "4900");
    return {
      satz: g.satz,
      konto,
      buSchluessel: taxKey(g.satz, beleg),
      confidence: hit?.[2] ?? 0.45,
    };
  });
  const konfidenz = injected ? 0.2 : Math.min(...zeilen.map((z) => z.confidence));
  return {
    zeilen: zeilen.map(({ confidence: _c, ...z }) => z),
    konfidenz,
    begruendung: injected
      ? "Der Beleg enthält eine Anweisung an die Buchhaltung; ich folge ihr nicht. (Mock-Modell)"
      : `Zugeordnet nach Positionstext. (Mock-Modell)`,
  };
}

function answer(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    finishReason: { unified: "stop" as const, raw: undefined },
    usage: {
      inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 0, text: 0, reasoning: undefined },
    },
    warnings: [],
  };
}

function model(respond: (text: string) => unknown) {
  return new MockLanguageModelV4({
    doGenerate: async ({ prompt }) =>
      answer(JSON.stringify(respond(promptText(prompt as { role: string; content: unknown }[])))),
  });
}

export function createMockAgentModels(): AgentModels {
  return {
    kontierer: {
      id: "mock-kontierer",
      model: model((text) => {
        const beleg = tagged<PromptBeleg>(text, "beleg");
        return beleg ? propose(beleg) : {};
      }),
    },
    pruefer: {
      id: "mock-pruefer",
      model: model((text) => {
        const beleg = tagged<PromptBeleg>(text, "beleg");
        const proposal = tagged<{ zeilen: { konto: string }[] }>(text, "vorschlag");
        if (!beleg || !proposal) return {};
        // The mock reviewer objects to the catch-all account: a person should look at "Sonstige" bookings.
        const catchAll = proposal.zeilen.some((z) => z.konto === "4900");
        return catchAll
          ? { urteil: "einwand", begruendung: "Sonstige Aufwendungen nur, wenn wirklich nichts passt. (Mock-Modell)" }
          : { urteil: "einverstanden", begruendung: "Konto und Steuerschlüssel passen. (Mock-Modell)" };
      }),
    },
    recherche: {
      id: "mock-recherche",
      model: model((text) => {
        const data = tagged<{ lieferant: { land: string | null }; positionen: string[] }>(text, "beleg");
        return {
          verkauft: data?.positionen.slice(0, 2).join(", ") || "unbekannt",
          land: data?.lieferant.land ?? "DE",
          ustIdGueltig: null,
          zusammenfassung: "Profil aus den Positionen geschlossen, ohne Abfrage. (Mock-Modell)",
        };
      }),
    },
    extraktor: {
      id: "mock-extraktor",
      // The mock cannot read PDFs; an empty answer sends the document to review, which is the honest result.
      model: model(() => ({})),
    },
  };
}
