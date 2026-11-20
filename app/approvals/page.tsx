import { cookies } from "next/headers";
import Link from "next/link";
import { approvedNotPaid, getWaitingCases, type WaitingCase } from "../../lib/approval.ts";
import { dollars } from "../../lib/money.ts";
import { readVisitorId, VISITOR_COOKIE } from "../../lib/visitor.ts";
import { appDb } from "./db.ts";
import { RetryForm } from "./Forms.tsx";
import { WaitingCard } from "./WaitingCard.tsx";
import "./approvals.css";

export const metadata = { title: "Human desk | Approval Desk" };
export const dynamic = "force-dynamic"; // always read the queue fresh

const BANNERS = new Map([
  ["rejected", "Rejected. Nothing was paid."],
  ["already_paid", "That refund was already paid. Nothing more was done."],
  ["unpaid", "Your approval is on record, but NOTHING was paid. See “Approved but not paid” below."],
]);

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ result?: string; refund?: string }> }) {
  const { result, refund } = await searchParams;
  const visitor = readVisitorId((await cookies()).get(VISITOR_COOKIE)?.value);
  let cases: WaitingCase[] = [];
  let unpaid: ReturnType<typeof approvedNotPaid> = [];
  let problem: string | null = null;
  let paid: { amount_cents: number; name: string } | undefined;
  try {
    const db = appDb();
    try {
      cases = getWaitingCases(db, visitor);
      unpaid = approvedNotPaid(db, visitor);
      // The banner only claims a payment that is really in the shop's refunds.
      paid = refund
        ? (db
            .prepare("SELECT r.amount_cents, c.name FROM refunds r JOIN orders o ON o.id = r.order_id JOIN customers c ON c.id = o.customer_id WHERE r.id = ?")
            .get(refund) as { amount_cents: number; name: string } | undefined)
        : undefined;
    } finally {
      db.close();
    }
  } catch {
    problem = "The shop data couldn't be read. If it isn't set up yet, run npm run seed, then reload this page.";
  }

  const banner =
    result === "paid" ? (paid ? `Paid ${dollars(paid.amount_cents)} to ${paid.name} (refund ${refund}).` : undefined) : result ? BANNERS.get(result) : undefined;

  const yours = cases.filter((c) => c.requestId.startsWith("TRY-"));
  const practice = cases.filter((c) => !c.requestId.startsWith("TRY-"));

  return (
    <main className="approvals">
      <p className="back">
        <Link href="/">← Back to the village</Link>
      </p>
      <h1>The human desk</h1>
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

      {yours.length > 0 && (
        <section aria-labelledby="waiting-title">
          <h2 id="waiting-title">Your requests ({yours.length})</h2>
          <p className="section-sub">Ones you sent that the gate handed to a person.</p>
          {yours.map((c) => (
            <WaitingCard key={c.gateEntryId} c={c} />
          ))}
        </section>
      )}

      {practice.length > 0 && (
        <section aria-labelledby="practice-title">
          <h2 id="practice-title">Waiting for you ({practice.length})</h2>
          <p className="section-sub">Requests the agent handled on its own but couldn&apos;t settle.</p>
          {practice.map((c) => (
            <WaitingCard key={c.gateEntryId} c={c} />
          ))}
        </section>
      )}

      {!problem && cases.length === 0 && (
        <div className="empty">
          <p>Nothing is waiting. Send a big refund to the agent and it lands here for you to decide.</p>
          <p>
            <Link href="/">Send one from the village →</Link>
          </p>
        </div>
      )}
    </main>
  );
}
