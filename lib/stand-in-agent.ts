import type { AskModel } from "./agent.ts";

// A stand-in for the AI, for browser tests only (picked when AGENT_STAND_IN=1). It never
// calls any API. It reads the prompt the real agent builds and answers by a word in the
// customer's message, so a test can drive each way the gate can go:
//   "small"   -> refund of up to $24 on the customer's first order (allowed when within the rules)
//   "big"     -> refund of the full price of their first order over $100 (a person decides, R2)
//   "garbled" -> not a form at all (blocked, R5)
//   anything else -> no answer, as if the AI were down (a person decides, R6)

type Order = { id: string; paidCents: number };

function ordersIn(prompt: string): Order[] {
  return [...prompt.matchAll(/^- (O\d+): .*, paid \$[\d.]+ \((\d+) cents\)$/gm)].map((m) => ({ id: m[1], paidCents: Number(m[2]) }));
}

function messageIn(prompt: string): string {
  const start = prompt.indexOf("<customer_message>");
  const end = prompt.indexOf("</customer_message>");
  return start >= 0 && end > start ? prompt.slice(start, end).toLowerCase() : "";
}

export const standInAgent: AskModel = async ({ user }) => {
  const message = messageIn(user);
  const orders = ordersIn(user);
  const policyLine = /^(P\d+) \(/m.exec(user)?.[1] ?? "P01";
  if (message.includes("garbled")) return "Sorry, I would rather chat than fill in a form.";
  if (message.includes("big")) {
    const order = orders.find((o) => o.paidCents > 10_000) ?? orders[0];
    if (order) return { action: "refund", orderId: order.id, amountCents: order.paidCents, reason: "The item arrived broken.", policyLine };
  }
  if (message.includes("small")) {
    const order = orders[0];
    if (order) {
      const amountCents = Math.min(2400, order.paidCents);
      return { action: "refund", orderId: order.id, amountCents, reason: "Part of the order arrived damaged.", policyLine };
    }
  }
  throw new Error("stand-in agent: no answer");
};
