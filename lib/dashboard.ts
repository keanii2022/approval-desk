// Read-only views for the owner's dashboard: the shop, the Inbox, the logbook and the
// dated eval scorecards. Plain SELECTs only: nothing here writes, so it works on the
// template opened read only as well as on a visitor's copy.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { canSeeRequest } from "./visitor.ts";

export type ShopTotals = { customers: number; orders: number; refunds: number; refundedCents: number };
export type CustomerRow = { id: string; name: string; orders: number; paidCents: number; refundedCents: number; flagged: boolean; joinedOn: string };
export type OrderRow = { id: string; customer: string; item: string; placedOn: string; paidCents: number; refundedCents: number; inTransit: boolean };
export type InboxRow = { id: string; customer: string; receivedOn: string; subject: string; status: string };
export type LogLine = { id: number; loggedAt: string; requestId: string; what: string };
export type DeskDecision = { verdict: string; result: string; rules: string[] };
export type ScorecardRow = {
  file: string;
  set: string;
  ranAt: string;
  model: string;
  accuracy: number;
  answers: number;
  gotThrough: number;
  prompt: string | null;
  decisions: DeskDecision[] | null; // every answer's gate result; null on scorecards from before Nov 21
};
export type DeskSet = { set: string; ranAt: string; answers: number; toPerson: number; perRule: Record<string, number> };
export type DeskLoad = { sets: DeskSet[]; rules: string[]; atDesk: number; rightAtDesk: number; wrongAtDesk: number };

const hasTable = (db: DatabaseSync, name: string) =>
  Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));

export function shopTotals(db: DatabaseSync): ShopTotals {
  const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return {
    customers: n("SELECT COUNT(*) AS n FROM customers"),
    orders: n("SELECT COUNT(*) AS n FROM orders"),
    refunds: n("SELECT COUNT(*) AS n FROM refunds"),
    refundedCents: n("SELECT COALESCE(SUM(amount_cents), 0) AS n FROM refunds"),
  };
}

export function customerRows(db: DatabaseSync): CustomerRow[] {
  const rows = db
    .prepare(
      `SELECT c.id, c.name, c.flagged, c.joined_on,
              (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) AS orders,
              (SELECT COALESCE(SUM(o.amount_paid_cents), 0) FROM orders o WHERE o.customer_id = c.id) AS paid,
              (SELECT COALESCE(SUM(r.amount_cents), 0) FROM refunds r JOIN orders o ON o.id = r.order_id WHERE o.customer_id = c.id) AS refunded
       FROM customers c ORDER BY c.id`,
    )
    .all() as { id: string; name: string; flagged: number; joined_on: string; orders: number; paid: number; refunded: number }[];
  return rows.map((r) => ({ id: r.id, name: r.name, orders: r.orders, paidCents: r.paid, refundedCents: r.refunded, flagged: r.flagged === 1, joinedOn: r.joined_on }));
}

export function orderRows(db: DatabaseSync): OrderRow[] {
  const rows = db
    .prepare(
      `SELECT o.id, c.name AS customer, o.item, o.placed_on, o.amount_paid_cents, o.in_transit,
              (SELECT COALESCE(SUM(r.amount_cents), 0) FROM refunds r WHERE r.order_id = o.id) AS refunded
       FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.id`,
    )
    .all() as { id: string; customer: string; item: string; placed_on: string; amount_paid_cents: number; in_transit: number; refunded: number }[];
  return rows.map((r) => ({ id: r.id, customer: r.customer, item: r.item, placedOn: r.placed_on, paidCents: r.amount_paid_cents, refundedCents: r.refunded, inTransit: r.in_transit === 1 }));
}

// Where each request stands, from its logbook lines: not run yet, paid, waiting, decided or blocked.
// A visitor sees the shop's own requests and their own tries, never someone else's.
export function inboxRows(db: DatabaseSync, visitorId: string | null): InboxRow[] {
  const requests = db
    .prepare("SELECT i.id, c.name AS customer, i.received_on, i.subject FROM inbox i JOIN customers c ON c.id = i.customer_id ORDER BY i.received_on DESC, i.id DESC")
    .all() as { id: string; customer: string; received_on: string; subject: string }[];
  const kinds = new Map<string, { gate?: string; human?: string; paid?: boolean }>();
  if (hasTable(db, "logbook")) {
    const lines = db.prepare("SELECT request_id, kind, details FROM logbook ORDER BY id").all() as { request_id: string; kind: string; details: string }[];
    for (const l of lines) {
      const k = kinds.get(l.request_id) ?? {};
      const d = JSON.parse(l.details) as { decision?: { result?: string } | string };
      if (l.kind === "gate_decision" && typeof d.decision === "object") k.gate = d.decision?.result;
      if (l.kind === "human_decision" && typeof d.decision === "string") k.human = d.decision;
      if (l.kind === "refund_done") k.paid = true;
      kinds.set(l.request_id, k);
    }
  }
  return requests
    .filter((r) => !r.id.startsWith("TRY-") || canSeeRequest(db, r.id, visitorId))
    .map((r) => {
      const k = kinds.get(r.id);
      const status = !k?.gate
        ? "Not run yet"
        : k.paid
          ? k.human === "approve" ? "Approved by a person, paid" : "Paid"
          : k.human === "reject"
            ? "Rejected by a person"
            : k.gate === "send_to_human"
              ? "Waiting for a person"
              : k.gate === "block"
                ? "Blocked"
                : "No refund";
      return { id: r.id, customer: r.customer, receivedOn: r.received_on, subject: r.subject, status };
    });
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// The newest logbook lines, each in a few plain words.
export function logLines(db: DatabaseSync, limit = 40): LogLine[] {
  if (!hasTable(db, "logbook")) return [];
  const rows = db.prepare("SELECT id, logged_at, request_id, kind, details FROM logbook ORDER BY id DESC LIMIT ?").all(limit) as {
    id: number;
    logged_at: string;
    request_id: string;
    kind: string;
    details: string;
  }[];
  return rows.map((r) => {
    const d = JSON.parse(r.details) as Record<string, any>;
    let what = r.kind;
    if (r.kind === "gate_decision") {
      const rules = (d.decision?.rules ?? []).join(", ");
      const result = { allow: "allowed", send_to_human: "sent to a person", block: "blocked" }[d.decision?.result as string] ?? d.decision?.result;
      what = `Gate: ${result}${rules ? ` (${rules})` : ""}${d.output?.status === "ai_down" ? ", the AI gave no answer" : ""}`;
    } else if (r.kind === "human_decision") {
      what = d.decision === "approve" ? `A person approved ${money(d.amountCents)} on ${d.orderId}${d.note ? `: "${d.note}"` : ""}` : `A person rejected it: "${d.note}"`;
    } else if (r.kind === "refund_done") {
      what = `Paid ${money(d.amountCents)} on ${d.orderId} (${d.refundId})`;
    } else if (r.kind === "refund_refused") {
      what = `Not paid: ${d.because}`;
    }
    return { id: r.id, loggedAt: r.logged_at, requestId: r.request_id, what };
  });
}

// Every saved scorecard in evals/, newest first.
export function scorecards(folder = join(process.cwd(), "evals")): ScorecardRow[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const c = JSON.parse(readFileSync(join(folder, f), "utf8")) as Record<string, any>;
      return {
        file: f.replace(/\.json$/, ".md"),
        set: f.includes("-partial") ? `${c.set} (some cases)` : String(c.set),
        ranAt: String(c.ranAt),
        model: String(c.model),
        accuracy: Number(c.accuracy),
        answers: Number(c.answers),
        gotThrough: Array.isArray(c.gotThrough) ? c.gotThrough.length : 0,
        prompt: typeof c.prompt === "string" ? c.prompt : null,
        decisions: Array.isArray(c.decisions) ? (c.decisions as DeskDecision[]) : null,
      };
    })
    .sort((a, b) => b.ranAt.localeCompare(a.ranAt));
}

// How many answers land at the human desk, per set and per rule, from the newest full
// scorecard of each set on the given prompt. An answer sent for two rules counts for both.
// At the desk, a "right" answer was correct and only needed a look; any other verdict is a
// wrong form that a reviewer who approves everything would let through.
export function deskLoad(cards: ScorecardRow[], prompt: string): DeskLoad {
  const newest = new Map<string, ScorecardRow>();
  for (const c of cards) {
    if (c.prompt !== prompt || !c.decisions || c.set.endsWith("(some cases)")) continue;
    const seen = newest.get(c.set);
    if (!seen || c.ranAt > seen.ranAt) newest.set(c.set, c);
  }
  const rules = new Set<string>();
  let rightAtDesk = 0;
  let wrongAtDesk = 0;
  const sets = [...newest.values()].map((c) => {
    const decisions = c.decisions ?? [];
    const perRule: Record<string, number> = {};
    let toPerson = 0;
    for (const d of decisions) {
      if (d.result !== "send_to_human") continue;
      toPerson++;
      if (d.verdict === "right") rightAtDesk++;
      else wrongAtDesk++;
      for (const r of d.rules) {
        perRule[r] = (perRule[r] ?? 0) + 1;
        rules.add(r);
      }
    }
    return { set: c.set, ranAt: c.ranAt, answers: decisions.length, toPerson, perRule };
  });
  const byNumber = (a: string, b: string) => Number(a.slice(1)) - Number(b.slice(1));
  return { sets, rules: [...rules].sort(byNumber), atDesk: rightAtDesk + wrongAtDesk, rightAtDesk, wrongAtDesk };
}
