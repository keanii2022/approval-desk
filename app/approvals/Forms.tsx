"use client";

import { startTransition, useActionState, useEffect, useState, type FormEvent } from "react";
import { approveAction, rejectAction, retryAction, type Decided, type FormState } from "./actions.ts";

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

// Inside the village: the decision stays on the page, and the village hears how it went.
function useDone(state: FormState, onDone: ((done: Decided) => void) | undefined) {
  const done = state.done;
  useEffect(() => {
    if (done) onDone?.(done);
    // onDone is a fresh function each render; only a new result should call it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);
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
  onDone?: (done: Decided) => void;
}) {
  const [state, action, pending] = useActionState(approveAction, start);
  const ready = useReady();
  useDone(state, props.onDone);
  return (
    <form onSubmit={sendWith(action)} className="decision" noValidate aria-label="Approve this refund">
      <input type="hidden" name="gateEntryId" value={props.gateEntryId} />
      {props.onDone ? <input type="hidden" name="stay" value="1" /> : null}
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

export function RejectForm({ gateEntryId, onDone }: { gateEntryId: number; onDone?: (done: Decided) => void }) {
  const [state, action, pending] = useActionState(rejectAction, start);
  const ready = useReady();
  useDone(state, onDone);
  return (
    <form onSubmit={sendWith(action)} className="decision" noValidate aria-label="Reject this refund">
      <input type="hidden" name="gateEntryId" value={gateEntryId} />
      {onDone ? <input type="hidden" name="stay" value="1" /> : null}
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
