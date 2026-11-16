import Link from "next/link";
import { ruleInWords } from "../../lib/approval.ts";
import type { AgentOutput, GateDecision } from "../../lib/gate.ts";
import { dollars } from "../../lib/money.ts";
import { MESSAGE_MAX, recentTries, SUBJECT_MAX, type Tried } from "../../lib/tryout.ts";
import { appDb } from "../approvals/db.ts";
import { type CustomerChoice, TryForm } from "./TryForm.tsx";
import "../approvals/approvals.css";

export const metadata = { title: "Try it | Approval Desk" };
export const dynamic = "force-dynamic";

const GATE_WORDS: Record<GateDecision["result"], string> = {
  allow: "Allowed",
  send_to_human: "Sent to a person",
  block: "Blocked",
};

type Form = { action?: unknown; orderId?: unknown; amountCents?: unknown; reason?: unknown; policyLine?: unknown };

function AgentAnswer({ agent }: { agent: AgentOutput | null }) {
  if (!agent) return <p className="muted">No answer on record.</p>;
  if (agent.status === "ai_down") return <p>The AI was unavailable, so there is no suggestion.</p>;
  const form = agent.form;
  if (typeof form !== "object" || form === null || Array.isArray(form)) {
    return (
      <p>
        Not a form. It sent back: <code>{JSON.stringify(form)}</code>
      </p>
    );
  }
  const f = form as Form;
  return (
    <table>
      <tbody>
        <tr><th>Action</th><td>{String(f.action)}</td></tr>
        <tr><th>Order</th><td>{f.orderId == null ? "none" : String(f.orderId)}</td></tr>
        <tr><th>Amount</th><td>{typeof f.amountCents === "number" ? dollars(f.amountCents) : "none"}</td></tr>
        <tr><th>Policy line</th><td>{String(f.policyLine)}</td></tr>
        <tr><th>Reason</th><td style={{ whiteSpace: "normal" }}>{String(f.reason)}</td></tr>
      </tbody>
    </table>
  );
}

function TriedCard({ tried, fresh }: { tried: Tried; fresh: boolean }) {
  return (
    <article className="card" aria-label={`${tried.requestId} result`} style={fresh ? { outline: "2px solid var(--accent)" } : undefined}>
      <h3>
        {tried.requestId}: {tried.subject}
      </h3>
      <p className="muted">From {tried.customerName}</p>
      <blockquote>{tried.message}</blockquote>
      <h4>What the agent filled in</h4>
      <AgentAnswer agent={tried.agent} />
      <h4>What the gate decided</h4>
      <p>
        {tried.gate ? GATE_WORDS[tried.gate.result] : "Nothing on record"}
        {tried.gate && tried.gate.rules.length > 0 ? `: ${tried.gate.rules.map(ruleInWords).join("; ")}.` : "."}
      </p>
      <h4>How it ended</h4>
      <p>
        {tried.outcome}
        {tried.gate?.result === "send_to_human" && tried.outcome.startsWith("Waiting") ? (
          <>
            {" "}
            <Link href="/approvals">Go decide →</Link>
          </>
        ) : null}
      </p>
    </article>
  );
}

export default async function TryPage({ searchParams }: { searchParams: Promise<{ ran?: string }> }) {
  const { ran } = await searchParams;
  let customers: CustomerChoice[] = [];
  let tries: Tried[] = [];
  let problem: string | null = null;
  try {
    const db = appDb();
    try {
      const rows = db
        .prepare(
          `SELECT c.id, c.name, GROUP_CONCAT(o.id || ' ' || o.item || ' $' || printf('%.2f', o.amount_paid_cents / 100.0), ', ') AS orders
           FROM customers c LEFT JOIN orders o ON o.customer_id = c.id GROUP BY c.id ORDER BY c.name`,
        )
        .all() as { id: string; name: string; orders: string | null }[];
      customers = rows.map((r) => ({ id: r.id, label: `${r.name}: ${r.orders ?? "no orders"}` }));
      tries = recentTries(db);
    } finally {
      db.close();
    }
  } catch {
    problem = "The shop data couldn't be read. If it isn't set up yet, run npm run seed, then reload this page.";
  }

  return (
    <main className="approvals">
      <p>
        <Link href="/">← Approval Desk</Link>
      </p>
      <h1>Try it yourself</h1>
      <p className="lede">
        Write a refund request as one of the shop’s customers. The real agent reads it, the gate checks its answer, and
        it ends up paid, waiting for a person, or blocked. Try to break it.
      </p>
      {problem ? (
        <p className="problem" role="alert">
          {problem}
        </p>
      ) : (
        <TryForm customers={customers} subjectMax={SUBJECT_MAX} messageMax={MESSAGE_MAX} />
      )}
      <h2>Your tries</h2>
      {tries.length === 0 ? (
        <p className="empty">Nothing tried yet.</p>
      ) : (
        tries.map((t) => <TriedCard key={t.requestId} tried={t} fresh={t.requestId === ran} />)
      )}
    </main>
  );
}
