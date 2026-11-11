import Link from "next/link";
import { approvedNotPaid, getWaitingCases, type WaitingCase } from "../../lib/approval.ts";
import { dollars } from "../../lib/money.ts";
import { appDb } from "./db.ts";
import { ApproveForm, RejectForm, RetryForm } from "./Forms.tsx";
import "./approvals.css";

export const metadata = { title: "Approvals | Approval Desk" };
export const dynamic = "force-dynamic"; // always read the queue fresh

const BANNERS = new Map([
  ["rejected", "Rejected. Nothing was paid."],
  ["already_paid", "That refund was already paid. Nothing more was done."],
  ["unpaid", "Your approval is on record, but NOTHING was paid. See “Approved but not paid” below."],
]);

function agentSays(c: WaitingCase): string {
  if (c.agent.status === "ai_down") return "The AI was unavailable, so there is no suggestion.";
  if (c.agent.action === "refund") {
    const amount = c.agent.suggestedAmountCents === null ? "" : ` of ${dollars(c.agent.suggestedAmountCents)}`;
    return `Suggested a refund${amount} on ${c.suggestedOrderId ?? "an order"}.`;
  }
  if (c.agent.action === "unsure") return "The agent was unsure what to do.";
  return "The agent's answer could not be read.";
}

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ result?: string; refund?: string }> }) {
  const { result, refund } = await searchParams;
  let cases: WaitingCase[] = [];
  let unpaid: ReturnType<typeof approvedNotPaid> = [];
  let problem: string | null = null;
  let refundIsReal = false;
  try {
    const db = appDb();
    try {
      cases = getWaitingCases(db);
      unpaid = approvedNotPaid(db);
      // The banner only claims a payment that is really in the shop's refunds.
      refundIsReal = Boolean(refund && db.prepare("SELECT 1 FROM refunds WHERE id = ?").get(refund));
    } finally {
      db.close();
    }
  } catch {
    problem = "The shop data couldn't be read. If it isn't set up yet, run npm run seed, then reload this page.";
  }

  const banner =
    result === "paid" ? (refundIsReal ? `Approved and paid. Refund ${refund} is done.` : undefined) : result ? BANNERS.get(result) : undefined;

  return (
    <main className="approvals">
      <p>
        <Link href="/">← Approval Desk</Link>
      </p>
      <h1>Approvals</h1>
      <p className="lede">
        Requests the gate sent to a person. You decide. Nothing is paid until you approve, and no one, including you, can
        refund more than was paid or refund someone else’s order.
      </p>

      {banner && (
        <p className={result === "unpaid" ? "banner warn" : "banner"} role="status">
          {banner}
        </p>
      )}
      {problem && (
        <p className="problem" role="alert">
          {problem}
        </p>
      )}

      {unpaid.length > 0 && (
        <section aria-labelledby="unpaid-title">
          <h2 id="unpaid-title">Approved but not paid ({unpaid.length})</h2>
          {unpaid.map((u) => (
            <article key={u.approvalEntryId} className="card warn">
              <p>
                <strong>{u.customerName}</strong>, request {u.requestId}: you approved {dollars(u.amountCents)} on {u.orderId}, but it
                was not paid{u.becauseWords ? `, because ${u.becauseWords}` : ""}.
              </p>
              {u.retryable ? (
                <RetryForm approvalEntryId={u.approvalEntryId} />
              ) : (
                <p>Trying again can’t fix this. The approval stays on record, and someone needs to look at it.</p>
              )}
            </article>
          ))}
        </section>
      )}

      <section aria-labelledby="waiting-title">
        <h2 id="waiting-title">Waiting for you ({cases.length})</h2>
        {!problem && cases.length === 0 && <p className="empty">Nothing is waiting for you.</p>}
        {cases.map((c) => (
          <article key={c.gateEntryId} className="card" aria-label={`Request ${c.requestId} from ${c.customer.name}`}>
            <header>
              <h3>
                {c.customer.name} <span className="muted">· {c.requestId} · received {c.request.receivedOn}</span>
              </h3>
            </header>
            <blockquote>
              <strong>{c.request.subject}</strong>
              <br />
              {c.request.body}
            </blockquote>
            <h4>Why a person must decide</h4>
            <ul>
              {c.why.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
            <h4>What the agent said</h4>
            <p>
              {agentSays(c)}
              {c.agent.reason && (
                <>
                  {" "}
                  Its reason: “{c.agent.reason}”{c.agent.policyLine ? ` (policy ${c.agent.policyLine})` : ""}
                </>
              )}
            </p>
            {c.orders.length === 0 ? (
              <p className="problem">This customer has no orders, so there is nothing to refund. You can only reject.</p>
            ) : (
              <ApproveForm
                gateEntryId={c.gateEntryId}
                fixed={c.orderFixed}
                suggestedOrderId={c.suggestedOrderId}
                suggestedAmount={c.agent.suggestedAmountCents === null ? "" : (c.agent.suggestedAmountCents / 100).toFixed(2)}
                orders={c.orders.map((o) => ({
                  id: o.id,
                  item: o.item,
                  placedOn: o.placedOn,
                  paid: dollars(o.paidCents),
                  refunded: dollars(o.refundedCents),
                  left: dollars(o.leftCents),
                }))}
              />
            )}
            <RejectForm gateEntryId={c.gateEntryId} />
          </article>
        ))}
      </section>
    </main>
  );
}
