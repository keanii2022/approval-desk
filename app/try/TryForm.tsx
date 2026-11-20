"use client";

import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import { NEW_CUSTOMER, type ReceiptCustomer } from "../../lib/try-fields.ts";
import { tryAction, type TryState } from "./actions.ts";

type Limits = { subjectMax: number; messageMax: number; nameMax: number };

function Receipt({ customer, isNew }: { customer: ReceiptCustomer | undefined; isNew: boolean }) {
  if (isNew) {
    return <p className="muted">Someone new to the shop: no orders. Any refund they ask for should be turned down.</p>;
  }
  if (!customer) return <p className="muted">Pick a customer to see what they bought.</p>;
  if (customer.orders.length === 0) return <p className="muted">{customer.name} hasn't bought anything.</p>;
  return (
    <table aria-label={`${customer.name}'s orders`}>
      <thead>
        <tr><th>Order</th><th>Item</th><th>Bought</th><th>Paid</th><th>Already refunded</th><th>Left</th></tr>
      </thead>
      <tbody>
        {customer.orders.map((o) => (
          <tr key={o.id}>
            <td><strong>{o.id}</strong></td><td>{o.item}</td><td>{o.placedOn}</td><td>{o.paid}</td><td>{o.refunded}</td><td>{o.left}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type TryFormProps = {
  customers: ReceiptCustomer[];
  limits: Limits;
  /** Inside the village panel: stay on the page and hand back the new request's ID. */
  onRan?: (requestId: string) => void;
  className?: string;
  /** No tries left: the form stays readable but can't be sent. */
  locked?: boolean;
};

export function TryForm({ customers, limits, onRan, className = "card decision try-form", locked = false }: TryFormProps) {
  const [state, action, pending] = useActionState<TryState, FormData>(tryAction, { error: null });
  const ranId = state.ranId;
  const ranHandler = useRef(onRan);
  ranHandler.current = onRan;
  useEffect(() => {
    if (ranId) ranHandler.current?.(ranId);
  }, [ranId]);
  const [customerId, setCustomerId] = useState("");
  // Buttons stay off until the page is ready, so an early click can't send the form the plain way.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  const isNew = customerId === NEW_CUSTOMER;
  const customer = customers.find((c) => c.id === customerId);

  // Sent without React clearing the form, so a refused message isn't lost.
  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => action(data));
  }

  return (
    <form className={className} onSubmit={send}>
      {onRan ? <input type="hidden" name="stay" value="1" /> : null}
      <label htmlFor="customerId">Write as</label>
      <select id="customerId" name="customerId" required value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
        <option value="" disabled>
          Pick a customer
        </option>
        <option value={NEW_CUSTOMER}>Someone new (type any name)</option>
        {customers.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      {isNew ? (
        <>
          <label htmlFor="newName">Their name</label>
          <input id="newName" name="newName" maxLength={limits.nameMax} required />
        </>
      ) : null}

      <Receipt customer={customer} isNew={isNew} />

      <label htmlFor="subject">Subject</label>
      <input id="subject" name="subject" maxLength={limits.subjectMax} placeholder="Anything you like" />
      <label htmlFor="message">Your message</label>
      <textarea
        id="message"
        name="message"
        rows={5}
        required
        maxLength={limits.messageMax}
        placeholder="Write it like a customer email."
      />
      {state.error ? (
        <p className="problem" role="alert">
          {state.error}
        </p>
      ) : null}
      <p>
        <button type="submit" disabled={!ready || pending || locked}>
          {pending ? "Asking the agent…" : "Send to the agent"}
        </button>
      </p>
    </form>
  );
}
