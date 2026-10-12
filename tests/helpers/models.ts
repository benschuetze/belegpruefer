import { MockLanguageModelV4 } from "ai/test";
import type { AgentModel, AgentModels } from "~/lib/agents/models";

type Reply = unknown | ((prompt: string) => unknown);

/** A model that answers with fixed JSON (or throws), and remembers every prompt it saw. */
export function fixedModel(id: string, reply: Reply, seen: string[] = []): AgentModel {
  return {
    id,
    model: new MockLanguageModelV4({
      doGenerate: async ({ prompt }) => {
        const text = JSON.stringify(prompt);
        seen.push(text);
        const value = typeof reply === "function" ? (reply as (p: string) => unknown)(text) : reply;
        if (value instanceof Error) throw value;
        return {
          content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
          finishReason: { unified: "stop", raw: undefined },
          usage: {
            inputTokens: { total: 1000, noCache: 1000, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 100, text: 100, reasoning: undefined },
          },
          warnings: [],
        };
      },
    }),
  };
}

export const AGREE = { urteil: "einverstanden", begruendung: "passt" };

export function team(
  kontierer: Reply,
  pruefer: Reply = AGREE,
  recherche: Reply = { verkauft: "Büromaterial", land: "DE", ustIdGueltig: true, zusammenfassung: "Händler" },
  seen: string[] = [],
): AgentModels {
  return {
    kontierer: fixedModel("claude-haiku-5-5", kontierer, seen),
    pruefer: fixedModel("claude-sonnet-5-5", pruefer, seen),
    recherche: fixedModel("claude-haiku-5-5", recherche, seen),
    extraktor: fixedModel("claude-sonnet-5-5", {}, seen),
  };
}

export const NO_RESEARCH = {
  viesCheck: async () => ({ valid: true }),
  supplierHistory: async () => [],
};
