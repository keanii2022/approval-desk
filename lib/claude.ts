import type { AskModel } from "./agent.ts";

// The real AI call: Claude's Messages API, with the form as a tool Claude must
// fill. The key is read from the environment (.env), never from the code.

const API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-5-5";
const TIMEOUT_MS = 30_000;
const FORM_TOOL = "fill_form";

const FORM_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["refund", "no_refund", "unsure"] },
    orderId: { type: ["string", "null"], description: "An order ID from the customer's orders, or null." },
    amountCents: { type: ["integer", "null"], description: "Refund amount in whole cents. null unless action is refund or unsure." },
    reason: { type: "string", description: "One short plain sentence saying why." },
    policyLine: { type: "string", description: "The ID of one policy line, like P02." },
  },
  required: ["action", "orderId", "amountCents", "reason", "policyLine"],
  additionalProperties: false,
};

type ContentBlock = { type: string; name?: string; input?: unknown; text?: string };

// Throws when there's no answer at all: no key, no connection, a timeout, or an
// error from the API. Otherwise returns what Claude filled in, unchecked. If
// Claude answered but not through the form, the text comes back and the gate
// blocks it as malformed (R5).
export const askClaude: AskModel = async ({ system, user }) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: process.env.AGENT_MODEL || DEFAULT_MODEL,
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: user }],
      tools: [{ name: FORM_TOOL, description: "Fill in the refund form for this request.", input_schema: FORM_SCHEMA }],
      tool_choice: { type: "tool", name: FORM_TOOL },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Claude API returned ${response.status}`);

  const body = (await response.json()) as { content?: ContentBlock[] };
  const blocks = Array.isArray(body.content) ? body.content : [];
  const filled = blocks.find((b) => b.type === "tool_use" && b.name === FORM_TOOL);
  if (filled) return filled.input;
  return blocks.map((b) => b.text ?? "").join("");
};
