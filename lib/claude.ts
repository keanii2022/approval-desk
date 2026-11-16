import Anthropic from "@anthropic-ai/sdk";
import type { AskModel } from "./agent.ts";

// The real AI call: Claude's Messages API, with the answer held to the form's
// JSON shape (structured output). The key is read from the environment (.env),
// never from the code.

const DEFAULT_MODEL = "claude-opus-5-5";
const TIMEOUT_MS = 60_000;

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
  return async ({ system, user }) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

    const client = new Anthropic({ apiKey, maxRetries, timeout: TIMEOUT_MS });
    const response = await client.beta.messages.create({
      model: process.env.AGENT_MODEL || DEFAULT_MODEL,
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { effort: "low", format: { type: "json_schema", schema: FORM_SCHEMA } },
      // If a safety check declines, the API retries on a fallback model inside the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    // A refusal isn't a form and isn't garbage either: treat it as no answer, so a human decides (R6).
    if (response.stop_reason === "refusal") throw new Error("Claude declined to answer");

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
