import { cookies } from "next/headers";
import Link from "next/link";
import { getWaitingCases, ruleInWords, type WaitingCase } from "../../lib/approval.ts";
import {
  customerRows,
  deskLoad,
  inboxRows,
  logLines,
  orderRows,
  scorecards,
  shopTotals,
  type CustomerRow,
  type DeskSet,
  type InboxRow,
  type LogLine,
  type OrderRow,
  type ScorecardRow,
  type ShopTotals,
} from "../../lib/dashboard.ts";
import { dollars } from "../../lib/money.ts";
import { promptVersion } from "../../lib/prompt.ts";
import { readVisitorId, VISITOR_COOKIE } from "../../lib/visitor.ts";
import { pageDb } from "../approvals/db.ts";
import { WaitingCard } from "../approvals/WaitingCard.tsx";
import "../approvals/approvals.css";

export const metadata = { title: "Dashboard | Approval Desk" };
export const dynamic = "force-dynamic"; // always read the shop fresh

const GITHUB_EVALS = "https://github.com/keanii2022/approval-desk/blob/main/evals/";
const SET_NAMES: Record<string, string> = { practice: "60 practice cases", hard: "60 hard cases", holes: "hole cases" };
const percent = (n: number) => `${(n * 100).toFixed(1)}%`;
const per100 = (count: number, s: DeskSet) => (s.answers === 0 ? "0" : ((count / s.answers) * 100).toFixed(0));

// The owner's view of everything: read only, apart from the human desk's own approve and reject.
export default async function DashboardPage() {
  const visitor = readVisitorId((await cookies()).get(VISITOR_COOKIE)?.value);
  let totals: ShopTotals | null = null;
  let customers: CustomerRow[] = [];
  let orders: OrderRow[] = [];
  let inbox: InboxRow[] = [];
  let waiting: WaitingCase[] = [];
  let log: LogLine[] = [];
  let problem: string | null = null;
  try {
    const db = pageDb(visitor);
    try {
      totals = shopTotals(db);
      customers = customerRows(db);
      orders = orderRows(db);
      inbox = inboxRows(db, visitor);
      waiting = getWaitingCases(db, visitor);
      log = logLines(db);
    } finally {
      db.close();
    }
  } catch {
    problem = "The shop data couldn't be read. If it isn't set up yet, run npm run seed, then reload this page.";
  }
  const cards = scorecards();
  const shipping = promptVersion();
  // The newest run on the prompt that ships; runs on prompts that were tried and rejected don't count.
  const latest = cards.find((c) => c.prompt === shipping) ?? cards.find((c) => c.prompt === null) ?? cards[0];
  const desk = deskLoad(cards, shipping);

  return (
    <main className="approvals dashboard">
      <p className="back">
        <Link href="/">← Back to the village</Link>
      </p>
      <h1>The dashboard</h1>
      <p className="lede">Everything in the shop, read only. Approving and rejecting happen at the human desk.</p>
      <nav className="dash-nav" aria-label="Sections">
        <a href="#shop">Shop</a>
        <a href="#inbox">Inbox</a>
        <a href="#desk">Human desk ({waiting.length})</a>
        <a href="#logbook">Logbook</a>
        <a href="#evals">Evals</a>
      </nav>
      {problem && (
        <p className="problem" role="alert">
          {problem}
        </p>
      )}

      <section id="shop" aria-labelledby="shop-title">
        <h2 id="shop-title">Shop</h2>
        {totals && (
          <ul className="dash-stats" aria-label="Shop totals">
            <li>
              <strong>{totals.customers}</strong> customers
            </li>
            <li>
              <strong>{totals.orders}</strong> orders
            </li>
            <li>
              <strong>{totals.refunds}</strong> refunds
            </li>
            <li>
              <strong>{dollars(totals.refundedCents)}</strong> refunded
            </li>
          </ul>
        )}
        <h3>Customers</h3>
        <div className="dash-scroll">
          <table aria-label="Customers">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Orders</th>
                <th>Paid</th>
                <th>Refunded</th>
                <th>Account</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.name} <span className="muted">{c.id}</span>
                  </td>
                  <td>{c.orders}</td>
                  <td>{dollars(c.paidCents)}</td>
                  <td>{dollars(c.refundedCents)}</td>
                  <td>{c.flagged ? "Flagged" : c.joinedOn > "2026-09-01" ? `New, joined ${c.joinedOn}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>Orders</h3>
        <div className="dash-scroll">
          <table aria-label="Orders">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Item</th>
                <th>Placed</th>
                <th>Paid</th>
                <th>Refunded</th>
                <th>Delivery</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>{o.id}</td>
                  <td>{o.customer}</td>
                  <td>{o.item}</td>
                  <td>{o.placedOn}</td>
                  <td>{dollars(o.paidCents)}</td>
                  <td>{o.refundedCents > 0 ? dollars(o.refundedCents) : ""}</td>
                  <td>{o.inTransit ? "In transit" : "Delivered"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="inbox" aria-labelledby="inbox-title">
        <h2 id="inbox-title">Inbox ({inbox.length})</h2>
        <p className="section-sub">Every request and where it stands. Your own tries show up here too.</p>
        <div className="dash-scroll">
          <table aria-label="Inbox">
            <thead>
              <tr>
                <th>Request</th>
                <th>From</th>
                <th>Received</th>
                <th>Subject</th>
                <th>Where it stands</th>
              </tr>
            </thead>
            <tbody>
              {inbox.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>{r.customer}</td>
                  <td>{r.receivedOn}</td>
                  <td>{r.subject}</td>
                  <td>{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="desk" aria-labelledby="desk-title">
        <h2 id="desk-title">Human desk ({waiting.length})</h2>
        <p className="section-sub">
          The same cards as the <Link href="/approvals">human desk</Link>: approve and pay, or reject with a note.
        </p>
        {waiting.length === 0 && !problem && <p className="empty">Nothing is waiting for a person.</p>}
        {waiting.map((c) => (
          <WaitingCard key={c.gateEntryId} c={c} />
        ))}
      </section>

      <section id="logbook" aria-labelledby="logbook-title">
        <h2 id="logbook-title">Logbook</h2>
        <p className="section-sub">Add-only. Every step is written here before it happens. Newest first.</p>
        {log.length === 0 ? (
          <p className="empty">Nothing has happened yet.</p>
        ) : (
          <div className="dash-scroll">
            <table aria-label="Logbook">
              <thead>
                <tr>
                  <th>#</th>
                  <th>When</th>
                  <th>Request</th>
                  <th>What happened</th>
                </tr>
              </thead>
              <tbody>
                {log.map((l) => (
                  <tr key={l.id}>
                    <td>{l.id}</td>
                    <td>{l.loggedAt.replace("T", " ").replace("Z", "")}</td>
                    <td>{l.requestId}</td>
                    <td className="dash-wrap">{l.what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section id="evals" aria-labelledby="evals-title">
        <h2 id="evals-title">Evals</h2>
        {latest ? (
          <p className="dash-latest">
            Latest scorecard: <strong>{latest.ranAt.slice(0, 10)}</strong>, {SET_NAMES[latest.set] ?? latest.set}, {percent(latest.accuracy)} right,{" "}
            {latest.gotThrough} got through{latest.prompt === shipping ? ", on the prompt that ships" : ""}.
          </p>
        ) : (
          <p className="empty">No scorecards yet. Run npm run evals.</p>
        )}
        <h3 id="load-title">Sent to a person, per 100 requests</h3>
        {desk.sets.length === 0 ? (
          <p className="empty">Shows after the next eval run.</p>
        ) : (
          <>
            <div className="dash-scroll">
              <table aria-labelledby="load-title">
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th>Why</th>
                    {desk.sets.map((s) => (
                      <th key={s.set}>{SET_NAMES[s.set] ?? s.set}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Any</td>
                    <td>Sent to a person for any reason</td>
                    {desk.sets.map((s) => (
                      <td key={s.set}>{per100(s.toPerson, s)}</td>
                    ))}
                  </tr>
                  {desk.rules.map((rule) => (
                    <tr key={rule}>
                      <td>{rule === "R6" ? "Unsure (R6)" : rule}</td>
                      <td>{ruleInWords(rule as Parameters<typeof ruleInWords>[0]) ?? ""}</td>
                      {desk.sets.map((s) => (
                        <td key={s.set}>{per100(s.perRule[rule] ?? 0, s)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="section-sub dash-desk-note">
              Of {desk.atDesk} answers sent to a person, {desk.rightAtDesk} were right and only needed a look; {desk.wrongAtDesk} were wrong and a person had
              to catch them. A reviewer who approves everything would pay those {desk.wrongAtDesk}.
            </p>
          </>
        )}
        <p className="section-sub">
          Every run, newest first. How prompt changes were scored: <a href="https://github.com/keanii2022/approval-desk/blob/main/EVALS.md">EVALS.md</a>.
        </p>
        <div className="dash-scroll">
          <table aria-label="Scorecards">
            <thead>
              <tr>
                <th>Ran</th>
                <th>Set</th>
                <th>Right</th>
                <th>Got through</th>
                <th>Prompt</th>
              </tr>
            </thead>
            <tbody>
              {cards.map((c: ScorecardRow) => (
                <tr key={c.file}>
                  <td>
                    <a href={GITHUB_EVALS + c.file}>{c.ranAt.replace("T", " ").replace("Z", "")}</a>
                  </td>
                  <td>{SET_NAMES[c.set] ?? c.set}</td>
                  <td>
                    {percent(c.accuracy)} <span className="muted">of {c.answers}</span>
                  </td>
                  <td>{c.gotThrough}</td>
                  <td>{c.prompt === null ? "" : c.prompt === shipping ? `${c.prompt} (ships)` : `${c.prompt} (tried, not kept)`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
