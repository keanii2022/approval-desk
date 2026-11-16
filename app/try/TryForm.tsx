"use client";

import { startTransition, useActionState, useEffect, useState, type FormEvent } from "react";
import { tryAction, type TryState } from "./actions.ts";

export type CustomerChoice = { id: string; label: string };

export function TryForm({ customers, subjectMax, messageMax }: { customers: CustomerChoice[]; subjectMax: number; messageMax: number }) {
  const [state, action, pending] = useActionState<TryState, FormData>(tryAction, { error: null });
  // Buttons stay off until the page is ready, so an early click can't send the form the plain way.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  // Sent without React clearing the form, so a refused message isn't lost.
  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => action(data));
  }

  return (
    <form className="card decision" onSubmit={send}>
      <label htmlFor="customerId">Write as</label>
      <select id="customerId" name="customerId" required defaultValue="">
        <option value="" disabled>
          Pick a customer
        </option>
        {customers.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <label htmlFor="subject">Subject</label>
      <input id="subject" name="subject" maxLength={subjectMax} />
      <label htmlFor="message">Message</label>
      <textarea id="message" name="message" rows={5} required maxLength={messageMax} />
      {state.error ? (
        <p className="problem" role="alert">
          {state.error}
        </p>
      ) : null}
      <p>
        <button type="submit" disabled={!ready || pending}>
          {pending ? "Asking the agent…" : "Send to the agent"}
        </button>
      </p>
    </form>
  );
}
