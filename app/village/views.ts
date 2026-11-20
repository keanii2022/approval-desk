// Turns a visitor's tries and waiting requests into plain words on the server, so the
// village panel (a client component) never imports the database code.
import { ruleInWords } from "../../lib/approval.ts";
import type { AgentOutput, GateDecision } from "../../lib/gate.ts";
import { dollars } from "../../lib/money.ts";
import type { Tried } from "../../lib/tryout.ts";
import type { VisitorRequest } from "./engine.ts";

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
  /** For the village's replay of this request. */
  rules: string[];
  orderId: string | null;
  amountCents: number | null;
  agentSays: string;
};


const GATE_WORDS: Record<GateDecision["result"], string> = {
  allow: "Allowed",
  send_to_human: "Sent to a person",
  block: "Blocked",
};

type Form = { action?: unknown; orderId?: unknown; amountCents?: unknown; reason?: unknown; policyLine?: unknown };

// What the robot says it suggested, in a few words.
function agentSays(agent: AgentOutput | null): string {
  if (!agent) return "Nothing on record.";
  if (agent.status === "ai_down") return "The AI did not answer.";
  const f = agent.form as Form | null;
  if (typeof f !== "object" || f === null || Array.isArray(f)) return "I got muddled. That is not a form.";
  if (f.action === "refund" && typeof f.amountCents === "number") return `I suggest ${dollars(f.amountCents)} back on ${String(f.orderId)}.`;
  if (f.action === "no_refund") return "I suggest no refund.";
  if (f.action === "unsure") return "I am not sure about this one.";
  return "I filled in something odd.";
}

function formNumbers(agent: AgentOutput | null): { orderId: string | null; amountCents: number | null } {
  const f = agent?.status === "answered" ? (agent.form as Form | null) : null;
  if (typeof f !== "object" || f === null || Array.isArray(f)) return { orderId: null, amountCents: null };
  return {
    orderId: typeof f.orderId === "string" ? f.orderId : null,
    amountCents: typeof f.amountCents === "number" ? f.amountCents : null,
  };
}

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
    rules: gate?.rules ?? [],
    ...formNumbers(tried.agent),
    agentSays: agentSays(tried.agent),
  };
}

// A word or three for the village logbook, from how it ended.
function logbookWord(outcome: string): string {
  if (outcome.startsWith("Refund paid")) return "PAID";
  if (outcome.startsWith("Waiting")) return "WAITING FOR A PERSON";
  if (outcome.startsWith("Blocked")) return "BLOCKED";
  if (outcome.startsWith("Not paid")) return "NOT PAID";
  if (outcome.startsWith("A person rejected")) return "REJECTED BY A PERSON";
  if (outcome.startsWith("A person approved")) return "APPROVED BY A PERSON";
  if (outcome.startsWith("Allowed")) return "ALLOWED - NOTHING TO PAY";
  return "NOT RECORDED";
}

/** The visitor's request as the village plays it, or null when the gate's decision isn't on record. */
export function visitorRequest(t: TryView): VisitorRequest | null {
  if (!t.gateResult) return null;
  return {
    id: t.requestId,
    customerName: t.customerName,
    light: t.gateResult,
    rules: t.rules,
    orderId: t.orderId,
    amountCents: t.amountCents,
    agentSays: t.agentSays,
    outcome: t.outcome,
    paid: t.outcome.startsWith("Refund paid"),
    word: logbookWord(t.outcome),
    decidable: t.waiting,
  };
}

