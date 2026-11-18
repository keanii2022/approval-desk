"use client";

import { startTransition, useActionState, useEffect, useState, type FormEvent } from "react";
import { approveAction, rejectAction, retryAction, type FormState } from "./actions.ts";

const start: FormState = { error: null };

// False until the page is ready in the browser. Until then the buttons stay off, so
// an early click can't send the form the plain way, with the fields in the address.
function useReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready;
}

// Sends the form to the server without letting React clear it afterwards. If a
// decision is refused, the person keeps what they typed and fixes it.
function sendWith(action: (data: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => action(data));
  };
}

function Problem({ state }: { state: FormState }) {
  return state.error ? (
    <p className="problem" role="alert">
      {state.error}
    </p>
  ) : null;
}

export type PickableOrder = { id: string; item: string; placedOn: string; paid: string; refunded: string; left: string };

export function ApproveForm(props: {
  gateEntryId: number;
  orders: PickableOrder[];
  fixed: boolean;
  suggestedOrderId: string | null;
  suggestedAmount: string;
}) {
  const [state, action, pending] = useActionState(approveAction, start);
  const ready = useReady();
  return (
    <form onSubmit={sendWith(action)} className="decision" noValidate aria-label="Approve this refund">
      <input type="hidden" name="gateEntryId" value={props.gateEntryId} />
      <h3>Approve</h3>
      <table className="orders">
        <thead>
          <tr>
            <th scope="col">{props.fixed ? "Order" : "Choose the order"}</th>
            <th scope="col">Item</th>
            <th scope="col">Placed</th>
            <th scope="col">Customer paid</th>
            <th scope="col">Already refunded</th>
            <th scope="col">Most you can refund</th>
          </tr>
        </thead>
        <tbody>
          {props.orders.map((o) => (
            <tr key={o.id}>
              <th scope="row">
                <label>
                  <input
                    type={props.fixed ? "hidden" : "radio"}
                    name="orderId"
                    value={o.id}
                    defaultChecked={o.id === props.suggestedOrderId}
                  />{" "}
                  {o.id}
                </label>
              </th>
              <td data-label="Item">{o.item}</td>
              <td data-label="Placed">{o.placedOn}</td>
              <td data-label="Customer paid">{o.paid}</td>
              <td data-label="Already refunded">{o.refunded}</td>
              <td data-label="Most you can refund" className="most">
                {o.left}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <label htmlFor={`amount-${props.gateEntryId}`}>Refund amount (dollars). You can change it.</label>
      <div className="pay-row">
        <input id={`amount-${props.gateEntryId}`} name="amount" inputMode="decimal" defaultValue={props.suggestedAmount} autoComplete="off" />
        <button type="submit" className="approve" disabled={pending || !ready}>
          Approve and pay
        </button>
      </div>
      <Problem state={state} />
    </form>
  );
}

export function RejectForm({ gateEntryId }: { gateEntryId: number }) {
  const [state, action, pending] = useActionState(rejectAction, start);
  const ready = useReady();
  return (
    <form onSubmit={sendWith(action)} className="decision" noValidate aria-label="Reject this refund">
      <input type="hidden" name="gateEntryId" value={gateEntryId} />
      <h3>Reject</h3>
      <label htmlFor={`note-${gateEntryId}`}>Why are you rejecting it? A note is required.</label>
      <textarea id={`note-${gateEntryId}`} name="note" rows={3} />
      <Problem state={state} />
      <button type="submit" className="reject" disabled={pending || !ready}>
        Reject
      </button>
    </form>
  );
}

export function RetryForm({ approvalEntryId }: { approvalEntryId: number }) {
  const [state, action, pending] = useActionState(retryAction, start);
  const ready = useReady();
  return (
    <form onSubmit={sendWith(action)} noValidate aria-label="Try paying this approval again">
      <input type="hidden" name="approvalEntryId" value={approvalEntryId} />
      <Problem state={state} />
      <button type="submit" disabled={pending || !ready}>
        Try paying again
      </button>
    </form>
  );
}
