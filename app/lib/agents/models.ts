import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

export type AgentRole = "kontierer" | "pruefer" | "recherche" | "extraktor";

/**
 * The reviewer runs on a different, stronger model than the booker on purpose: two calls of the same model share
 * its blind spots, so a second opinion from the same model mostly agrees with itself.
 */
export const DEFAULT_MODEL_IDS: Record<AgentRole, string> = {
  kontierer: "claude-haiku-5-5",
  pruefer: "claude-sonnet-5-5",
  recherche: "claude-haiku-5-5",
  extraktor: "claude-sonnet-5-5",
};

/** US$ per million tokens (input, output, cache read), Anthropic list prices as of 2026-10. */
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
};

export type Usage = { inputTokens: number; outputTokens: number; cacheReadTokens: number };

/**
 * Cost in millionths of a cent. $1 per million tokens is 100 cents per million, i.e. 100 microcents per token,
 * so integers stay exact even for the cheapest model.
 */
export function costMicrocents(modelId: string, usage: Usage): number {
  const price = PRICES[modelId];
  if (!price) return 0;
  const uncached = Math.max(0, usage.inputTokens - usage.cacheReadTokens);
  return Math.round(
    100 * (uncached * price.input + usage.cacheReadTokens * price.cacheRead + usage.outputTokens * price.output),
  );
}

export type AgentModel = { id: string; model: LanguageModel };
export type AgentModels = Record<AgentRole, AgentModel>;

/** null: no key and no mock, so every document goes straight to review. */
export async function getAgentModels(): Promise<AgentModels | null> {
  if (process.env.AI_MOCK === "1") {
    const { createMockAgentModels } = await import("./mock");
    return createMockAgentModels();
  }
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return getLiveAgentModels();
}

export function getLiveAgentModels(options: { fetch?: typeof fetch } = {}): AgentModels {
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  const provider = createAnthropic({
    headers: workspace ? { "anthropic-workspace-id": workspace } : undefined,
    fetch: options.fetch,
  });
  const id = (role: AgentRole) => process.env[`AI_MODEL_${role.toUpperCase()}`] || DEFAULT_MODEL_IDS[role];
  const entry = (role: AgentRole): AgentModel => ({ id: id(role), model: provider(id(role)) });
  return {
    kontierer: entry("kontierer"),
    pruefer: entry("pruefer"),
    recherche: entry("recherche"),
    extraktor: entry("extraktor"),
  };
}
