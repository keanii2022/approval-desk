import type { WaitingCase } from "../../lib/approval.ts";
import { dollars } from "../../lib/money.ts";
import type { Decided } from "./actions.ts";
import { ApproveForm, RejectForm } from "./Forms.tsx";

function agentSays(c: WaitingCase): string {
  if (c.agent.status === "ai_down") return "The AI was unavailable, so there is no suggestion.";
  if (c.agent.action === "refund") {
    const amount = c.agent.suggestedAmountCents === null ? "" : ` of ${dollars(c.agent.suggestedAmountCents)}`;
    return `Suggested a refund${amount} on ${c.suggestedOrderId ?? "an order"}.`;
  }
  if (c.agent.action === "unsure") return "The agent was unsure what to do.";
  return "The agent's answer could not be read.";
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/** One request waiting for a person, with the approve and reject forms. In the village, onDone hears the decision. */
export function WaitingCard({ c, onDone }: { c: WaitingCase; onDone?: (done: Decided) => void }) {
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
            onDone={onDone}
          />
        )}
        <RejectForm gateEntryId={c.gateEntryId} onDone={onDone} />
      </div>
    </article>
  );
}
