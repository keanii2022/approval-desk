// The console rail of the Human Desk: what a person reads and decides on. One
// panel per waiting request, plus the approvals that were never paid. Server
// components only; the forms inside them (Forms.tsx) are the client side, and
// every decision goes through the server actions. Nothing here changes data.
import type { ReactNode } from "react";
import type { ApprovedNotPaid, WaitingCase } from "../../lib/approval.ts";
import { dollars } from "../../lib/money.ts";
import { AmountBlock, Badge, Divider, PanelBody, PanelHeader, PanelHeading, RuleRow, StatusRow } from "../village/ui.tsx";
import { ApproveForm, RejectForm, RetryForm } from "./Forms.tsx";

/** The shared panel frame (the same classes as EncounterPanel), as an <article> with a tone.
 *  Local because the shared EncounterPanel is always a cream <section>. */
export function DeskPanel({
  label,
  tone = "cream",
  className,
  children,
}: {
  /** The article's accessible name. Tests find a waiting request by it. */
  label?: string;
  tone?: "cream" | "red";
  className?: string;
  children: ReactNode;
}) {
  return (
    <article className={`v-panel hd-panel hd-panel--${tone}${className ? ` ${className}` : ""}`} aria-label={label}>
      <div className="v-panel-display">{children}</div>
    </article>
  );
}

/** A section heading in the rail, under the encounter indicator. */
export function SectionTitle({ tone = "steel", children }: { tone?: "steel" | "red"; children: ReactNode }) {
  return <h2 className={`hd-section-title hd-section-title--${tone}`}>{children}</h2>;
}

/** Something that stopped the desk, as a red rule row. Only the words are in the DOM
 *  (the × mark is drawn by CSS), so tests and screen readers get the exact message. */
export function Problem({ inRail = false, children }: { inRail?: boolean; children: ReactNode }) {
  return (
    <p role="alert" className={`v-rule v-rule--red hd-problem${inRail ? " hd-problem--rail" : ""}`}>
      {children}
    </p>
  );
}

export function EmptyPanel() {
  return (
    <DeskPanel>
      <PanelHeader title="Human desk / queue" aside="00 waiting" />
      <PanelBody>
        <p className="hd-empty">Nothing is waiting for you.</p>
      </PanelBody>
    </DeskPanel>
  );
}

// An approval that is on record but was never paid. No aria-label on purpose: a
// person's decision counts once, so the request id must not name a second article.
export function UnpaidPanel({ unpaid: u }: { unpaid: ApprovedNotPaid }) {
  return (
    <DeskPanel tone="red">
      <PanelHeader title="Human desk / not paid" aside={u.requestId} />
      <PanelBody>
        <PanelHeading badge={<Badge tone="red">Not paid</Badge>}>{u.customerName}</PanelHeading>
        <AmountBlock label="Approved, not paid" amount={dollars(u.amountCents)} tone="red" />
        <p className="hd-note">
          <strong>{u.customerName}</strong>, request {u.requestId}: you approved {dollars(u.amountCents)} on {u.orderId}, but it was not paid
          {u.becauseWords ? `, because ${u.becauseWords}` : ""}.
        </p>
        {u.retryable ? (
          <RetryForm approvalEntryId={u.approvalEntryId} />
        ) : (
          <p className="hd-note">Trying again can’t fix this. The approval stays on record, and someone needs to look at it.</p>
        )}
      </PanelBody>
    </DeskPanel>
  );
}

function agentSays(c: WaitingCase): string {
  if (c.agent.status === "ai_down") return "The AI was unavailable, so there is no suggestion.";
  if (c.agent.action === "refund") {
    const amount = c.agent.suggestedAmountCents === null ? "" : ` of ${dollars(c.agent.suggestedAmountCents)}`;
    return `Suggested a refund${amount} on ${c.suggestedOrderId ?? "an order"}.`;
  }
  if (c.agent.action === "unsure") return "The agent was unsure what to do.";
  return "The agent's answer could not be read.";
}

function agentLine(c: WaitingCase): string {
  const reason = c.agent.reason ? ` Its reason: “${c.agent.reason}”${c.agent.policyLine ? ` (policy ${c.agent.policyLine})` : ""}` : "";
  return agentSays(c) + reason;
}

/** The customer's own words, as a letter on the desk. */
function Letter({ subject, body }: { subject: string; body: string }) {
  return (
    <blockquote className="hd-letter">
      <span className="hd-letter-label">Customer’s message</span>
      <strong className="hd-letter-subject">{subject}</strong>
      <p className="hd-letter-body">{body}</p>
    </blockquote>
  );
}

/** One waiting request: what the person needs to know, then the decision. */
export function CasePanel({ c }: { c: WaitingCase }) {
  return (
    <DeskPanel label={`Request ${c.requestId} from ${c.customer.name}`} className="hd-case">
      <PanelHeader title="Human desk / request" aside={c.requestId} />
      <PanelBody>
        <PanelHeading badge={<Badge tone="blue">Received {c.request.receivedOn}</Badge>}>{c.customer.name}</PanelHeading>
        {c.agent.suggestedAmountCents === null ? (
          <div className="v-amount v-amount--ink hd-amount--none">
            <div className="v-amount-label v-mono">Suggested refund</div>
            <div className="v-amount-value">No amount</div>
          </div>
        ) : (
          <AmountBlock label="Suggested refund" amount={dollars(c.agent.suggestedAmountCents)} />
        )}
        <Letter subject={c.request.subject} body={c.request.body} />
        <Divider />
        {c.why.map((w) => (
          <RuleRow key={w} tone="blue" symbol="!" title={w} sub="Needs a human" />
        ))}
        <div className="hd-agent">
          <StatusRow title="What the agent said" sub={agentLine(c)} />
        </div>
        <Divider />
        {c.orders.length === 0 ? (
          <RuleRow tone="red" symbol="×" title="Nothing to refund" sub="This customer has no orders, so there is nothing to refund. You can only reject." />
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
      </PanelBody>
    </DeskPanel>
  );
}
