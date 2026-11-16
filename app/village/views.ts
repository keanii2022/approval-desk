// Turns a visitor's tries and waiting requests into plain words on the server, so the
// village panel (a client component) never imports the database code.
import { ruleInWords, type WaitingCase } from "../../lib/approval.ts";
import type { AgentOutput, GateDecision } from "../../lib/gate.ts";
import { dollars } from "../../lib/money.ts";
import type { Tried } from "../../lib/tryout.ts";

export type AgentView =
  | { kind: "none" }
  | { kind: "ai_down" }
  | { kind: "not_form"; raw: string }
  | { kind: "form"; rows: [label: string, value: string][] };

export type TryView = {
  requestId: string;
  subject: string;
  customerName: string;
  message: string;
  agent: AgentView;
  gate: string;
  gateResult: GateDecision["result"] | null;
  outcome: string;
  waiting: boolean;
};

export type WaitingView = { requestId: string; customerName: string; subject: string; why: string[]; waitingSince: string };

const GATE_WORDS: Record<GateDecision["result"], string> = {
  allow: "Allowed",
  send_to_human: "Sent to a person",
  block: "Blocked",
};

type Form = { action?: unknown; orderId?: unknown; amountCents?: unknown; reason?: unknown; policyLine?: unknown };

function agentView(agent: AgentOutput | null): AgentView {
  if (!agent) return { kind: "none" };
  if (agent.status === "ai_down") return { kind: "ai_down" };
  const form = agent.form;
  if (typeof form !== "object" || form === null || Array.isArray(form)) return { kind: "not_form", raw: JSON.stringify(form) };
  const f = form as Form;
  return {
    kind: "form",
    rows: [
      ["Action", String(f.action)],
      ["Order", f.orderId == null ? "none" : String(f.orderId)],
      ["Amount", typeof f.amountCents === "number" ? dollars(f.amountCents) : "none"],
      ["Policy line", String(f.policyLine)],
      ["Reason", String(f.reason)],
    ],
  };
}

export function tryView(tried: Tried): TryView {
  const gate = tried.gate;
  return {
    requestId: tried.requestId,
    subject: tried.subject,
    customerName: tried.customerName,
    message: tried.message,
    agent: agentView(tried.agent),
    gate: gate ? `${GATE_WORDS[gate.result]}${gate.rules.length > 0 ? `: ${gate.rules.map(ruleInWords).join("; ")}.` : "."}` : "Nothing on record.",
    gateResult: gate?.result ?? null,
    outcome: tried.outcome,
    waiting: gate?.result === "send_to_human" && tried.outcome.startsWith("Waiting"),
  };
}

// Only the visitor's own tries: the seeded practice cases are on the approval screen for everyone.
export function waitingViews(cases: WaitingCase[]): WaitingView[] {
  return cases
    .filter((c) => c.requestId.startsWith("TRY-"))
    .map((c) => ({ requestId: c.requestId, customerName: c.customer.name, subject: c.request.subject, why: c.why, waitingSince: c.waitingSince }));
}
