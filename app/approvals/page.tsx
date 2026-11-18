import { cookies } from "next/headers";
import Link from "next/link";
import { approvedNotPaid, getWaitingCases, type WaitingCase } from "../../lib/approval.ts";
import { dollars } from "../../lib/money.ts";
import { readVisitorId, VISITOR_COOKIE } from "../../lib/visitor.ts";
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
  const visitor = readVisitorId((await cookies()).get(VISITOR_COOKIE)?.value);
  let cases: WaitingCase[] = [];
  let unpaid: ReturnType<typeof approvedNotPaid> = [];
  let problem: string | null = null;
  let refundIsReal = false;
  try {
    const db = appDb();
    try {
      cases = getWaitingCases(db, visitor);
      unpaid = approvedNotPaid(db, visitor);
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

  const yours = cases.filter((c) => c.requestId.startsWith("TRY-"));
  const practice = cases.filter((c) => !c.requestId.startsWith("TRY-"));

  return (
    <main className="approvals">
      <p className="back">
        <Link href="/">← Back to the village</Link>
      </p>
      <h1>Approvals</h1>
      <p className="lede">The gate sends some refunds to a person instead of paying them. Here, that person is you.</p>
      <ul className="guards" aria-label="What no one can do, you included">
        <li>Nothing is paid until you approve</li>
        <li>No refund over what was paid</li>
        <li>No refund on someone else’s order</li>
      </ul>

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
        <h2 id="waiting-title">Waiting for you ({yours.length})</h2>
        {!problem && yours.length === 0 && (
          <div className="empty">
            <p>Nothing of yours is waiting. Send a big refund to the agent and it lands here for you to decide.</p>
            <p>
              <Link href="/">Send one from the village →</Link>
            </p>
          </div>
        )}
        {yours.map((c) => (
          <WaitingCard key={c.gateEntryId} c={c} />
        ))}
      </section>

      {practice.length > 0 && (
        <section aria-labelledby="practice-title">
          <h2 id="practice-title">Practice requests ({practice.length})</h2>
          <p className="section-sub">Made-up requests from the invented shop, so there is always something to decide.</p>
          {practice.map((c) => (
            <WaitingCard key={c.gateEntryId} c={c} />
          ))}
        </section>
      )}
    </main>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

function WaitingCard({ c }: { c: WaitingCase }) {
  return (
    <article className="card" aria-label={`Request ${c.requestId} from ${c.customer.name}`}>
      <header className="case-head">
        <span className="avatar" aria-hidden="true">
          {initials(c.customer.name)}
        </span>
        <div>
          <h3>{c.customer.name}</h3>
          <p className="meta">
            {c.requestId} · received {c.request.receivedOn}
          </p>
        </div>
      </header>
      <ul className="why" aria-label="Why a person must decide">
        {c.why.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
      <blockquote>
        <span className="subject">{c.request.subject || "(no subject)"}</span>
        {c.request.body}
      </blockquote>
      <div className="agent">
        <p className="label">What the agent said</p>
        <p>{agentSays(c)}</p>
        {c.agent.reason && (
          <p className="reason">
            “{c.agent.reason}”{c.agent.policyLine ? ` · policy ${c.agent.policyLine}` : ""}
          </p>
        )}
      </div>
      <div className="decide">
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
      </div>
    </article>
  );
}
