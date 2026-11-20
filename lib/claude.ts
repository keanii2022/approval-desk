import Anthropic from "@anthropic-ai/sdk";
import type { AskModel } from "./agent.ts";
import { costUsd } from "./trace.ts";

// The real AI call: Claude's Messages API, with the answer held to the form's
// JSON shape (structured output). The key is read from the environment (.env),
// never from the code.

const DEFAULT_MODEL = "claude-opus-5-5";
const TIMEOUT_MS = 60_000;

export const agentModel = (): string => process.env.AGENT_MODEL || DEFAULT_MODEL;

const nullable = (type: "string" | "integer", description: string) => ({
  anyOf: [{ type }, { type: "null" }],
  description,
});

const FORM_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["refund", "no_refund", "unsure"] },
    orderId: nullable("string", "An order ID from the customer's orders, or null."),
    amountCents: nullable("integer", "Refund amount in whole cents. null unless action is refund or unsure."),
    reason: { type: "string", description: "One short plain sentence saying why." },
    policyLine: { type: "string", description: "The ID of one policy line, like P02." },
  },
  required: ["action", "orderId", "amountCents", "reason", "policyLine"],
  additionalProperties: false,
};

// Throws when there's no answer at all: no key, no connection, a timeout, an
// error from the API, or a refusal. Otherwise returns what Claude filled in,
// unchecked. Anything that isn't a clean form (cut-off JSON, plain text, an
// empty reply) comes back as it is, and the gate blocks it as malformed (R5).
export function claudeAgent({ maxRetries = 2 }: { maxRetries?: number } = {}): AskModel {
  return async ({ system, user }, reportTrace) => {
    const model = agentModel();
    const started = performance.now();
    const elapsedMs = () => Math.round(performance.now() - started);
    // No answer: the trace keeps the time and the error, and no tokens.
    const fail = (error: string): never => {
      reportTrace?.({ model, durationMs: elapsedMs(), error });
      throw new Error(error);
    };

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return fail("ANTHROPIC_API_KEY is not set");

    const client = new Anthropic({ apiKey, maxRetries, timeout: TIMEOUT_MS });
    let response;
    try {
      response = await client.beta.messages.create({
        model,
        max_tokens: 4000, // caps what one call can cost; a cut-off answer is blocked by the gate (R5)
        system,
        messages: [{ role: "user", content: user }],
        output_config: { effort: "low", format: { type: "json_schema", schema: FORM_SCHEMA } },
        // If a safety check declines, the API retries on a fallback model inside the same call.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }

    // response.model, not the one asked for: a fallback model may have answered.
    const answeredBy = response.model || model;
    const tokens = {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      cacheReadTokens: response.usage?.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage?.cache_creation_input_tokens ?? 0,
    };
    const trace = { model: answeredBy, durationMs: elapsedMs(), ...tokens, costUsd: costUsd(answeredBy, tokens) };

    // A refusal isn't a form and isn't garbage either: treat it as no answer, so a human decides (R6).
    // Its tokens were still billed, so its trace keeps them.
    if (response.stop_reason === "refusal") {
      reportTrace?.({ ...trace, error: "Claude declined to answer" });
      throw new Error("Claude declined to answer");
    }
    reportTrace?.(trace);

    const text = (response.content ?? [])
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("");
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };
}

export const askClaude = claudeAgent();
