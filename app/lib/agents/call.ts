import { generateText, type ModelMessage, Output, type StopCondition, type ToolSet } from "ai";
import type { z } from "zod";
import { safeError } from "~/lib/security.server";
import { type AgentModel, costMicrocents, type Usage } from "./models";

export type AgentResult<T> = {
  /** null when the model failed, answered nonsense or the answer did not pass the schema. Never a guess. */
  output: T | null;
  error: string | null;
  usage: Usage;
  costMicrocents: number;
  durationMs: number;
  model: string;
};

type CallOptions<T> = {
  agent: AgentModel;
  system: string;
  messages: ModelMessage[];
  schema: z.ZodType<T>;
  maxOutputTokens?: number;
  tools?: ToolSet;
  stopWhen?: StopCondition<ToolSet>;
};

/**
 * One structured call. The system prompt (rules plus account list) is the stable prefix and is marked for prompt
 * caching; the document goes into the user message. Every failure becomes `output: null` so the caller can send the
 * document to review instead of crashing or guessing.
 */
export async function callAgent<T>(options: CallOptions<T>): Promise<AgentResult<T>> {
  const started = Date.now();
  const empty: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  try {
    const result = await generateText({
      model: options.agent.model,
      instructions: {
        role: "system",
        content: options.system,
        providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
      },
      messages: options.messages,
      output: Output.object({ schema: options.schema }),
      tools: options.tools,
      stopWhen: options.stopWhen,
      maxRetries: 2,
      // Short structured answers; the cap only stops a runaway response from eating credits.
      maxOutputTokens: options.maxOutputTokens ?? 4000,
      providerOptions: { anthropic: { effort: "low" } },
    });
    const usage: Usage = {
      inputTokens: result.totalUsage.inputTokens ?? 0,
      outputTokens: result.totalUsage.outputTokens ?? 0,
      cacheReadTokens: result.totalUsage.inputTokenDetails?.cacheReadTokens ?? 0,
    };
    const parsed = options.schema.safeParse(result.output);
    return {
      output: parsed.success ? parsed.data : null,
      error: parsed.success ? null : "Antwort passt nicht zum Schema",
      usage,
      costMicrocents: costMicrocents(options.agent.id, usage),
      durationMs: Date.now() - started,
      model: options.agent.id,
    };
  } catch (error) {
    return {
      output: null,
      error: safeError(error),
      usage: empty,
      costMicrocents: 0,
      durationMs: Date.now() - started,
      model: options.agent.id,
    };
  }
}
