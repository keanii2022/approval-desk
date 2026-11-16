"use client";

// The front page: the village plays its made-up stories, and two of its places open a panel
// over it with the visitor's own requests. The Inbox holds the try form and, after sending,
// the result; the human desk lists the visitor's requests waiting for a person.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ReceiptCustomer } from "../../lib/try-fields.ts";
import { TryForm } from "../try/TryForm.tsx";
import VillageCanvas, { type VillagePlace, type VisitorRequest } from "./VillageCanvas.tsx";
import { visitorRequest, type AgentView, type TryView, type WaitingView } from "./views.ts";
import "./home.css";

const GITHUB = "https://github.com/keanii2022/approval-desk";

type Props = {
  customers: ReceiptCustomer[];
  tries: TryView[];
  waiting: WaitingView[];
  problem: string | null;
  limits: { subjectMax: number; messageMax: number; nameMax: number };
};

function AgentAnswer({ agent }: { agent: AgentView }) {
  if (agent.kind === "none") return <p className="vh-muted">No answer on record.</p>;
  if (agent.kind === "ai_down") return <p>The AI was unavailable, so there is no suggestion.</p>;
  if (agent.kind === "not_form")
    return (
      <p>
        Not a form. It sent back: <code>{agent.raw}</code>
      </p>
    );
  return (
    <table className="vh-form-table">
      <tbody>
        {agent.rows.map(([label, value]) => (
          <tr key={label}>
            <th scope="row">{label}</th>
            <td>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const LIGHT: Record<NonNullable<TryView["gateResult"]>, string> = { allow: "go", send_to_human: "ask", block: "stop" };

function Result({ tried, onAnother, onWatch }: { tried: TryView | undefined; onAnother: () => void; onWatch: () => void }) {
  if (!tried) return <p className="vh-muted">Reading the logbook…</p>;
  return (
    <article className="vh-result" aria-label={`${tried.requestId} result`}>
      <p className="vh-kicker">
        {tried.requestId} · from {tried.customerName}
      </p>
      <h3>{tried.subject || "(no subject)"}</h3>
      <blockquote>{tried.message}</blockquote>
      <h4>What the agent filled in</h4>
      <AgentAnswer agent={tried.agent} />
      <h4>What the gate decided</h4>
      <p className="vh-gate">
        {tried.gateResult ? <span className={`vh-light vh-light-${LIGHT[tried.gateResult]}`} aria-hidden="true" /> : null}
        {tried.gate}
      </p>
      <h4>How it ended</h4>
      <p>{tried.outcome}</p>
      <div className="vh-actions">
        {tried.gateResult ? (
          <button type="button" className="vh-button-go" onClick={onWatch}>
            Watch it in the village
          </button>
        ) : null}
        <button type="button" onClick={onAnother}>
          Send another
        </button>
        {tried.waiting ? (
          <Link className="vh-button vh-button-go" href="/approvals">
            Decide it yourself →
          </Link>
        ) : null}
      </div>
    </article>
  );
}

function DeskPanel({ waiting, toInbox }: { waiting: WaitingView[]; toInbox: () => void }) {
  return (
    <>
      <p className="vh-lede">
        Requests you sent that the gate handed to a person. On the approval screen you decide them: approve and pay, or
        reject.
      </p>
      {waiting.length === 0 ? (
        <div className="vh-empty">
          <p>Nothing of yours is waiting. Big refunds, old orders and anything the agent can&apos;t answer end up here.</p>
          <button type="button" onClick={toInbox}>
            Write one at the Inbox
          </button>
        </div>
      ) : (
        <ul className="vh-waiting" aria-label="Your requests waiting for a person">
          {waiting.map((w) => (
            <li key={w.requestId}>
              <p className="vh-kicker">
                {w.requestId} · from {w.customerName}
              </p>
              <p className="vh-waiting-subject">{w.subject || "(no subject)"}</p>
              <p className="vh-muted">Why a person: {w.why.join("; ")}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="vh-actions">
        <Link className="vh-button vh-button-go" href="/approvals">
          Open the approval screen →
        </Link>
      </div>
    </>
  );
}

export default function VillageHome({ customers, tries, waiting, problem, limits }: Props) {
  const [panel, setPanel] = useState<VillagePlace | null>(null);
  const [ranId, setRanId] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  // The visitor's last request waits here until the panel closes, then the village plays it.
  const [queued, setQueued] = useState<VisitorRequest | null>(null);
  const [play, setPlay] = useState<{ key: number; request: VisitorRequest } | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<Element | null>(null);

  const openPlace = useCallback((place: VillagePlace) => {
    returnFocus.current = document.activeElement;
    setPanel(place);
    return true;
  }, []);
  // Closing after a result means the next visit to the Inbox starts a fresh request; a half-written one is kept.
  const close = useCallback(() => {
    setPanel(null);
    setRanId((ran) => {
      if (ran) setFormKey((k) => k + 1);
      return null;
    });
    const back = returnFocus.current;
    if (back instanceof HTMLElement) back.focus();
  }, []);
  const another = () => {
    setRanId(null);
    setFormKey((k) => k + 1);
  };

  const tried = ranId ? tries.find((t) => t.requestId === ranId) : undefined;
  useEffect(() => {
    const request = tried ? visitorRequest(tried) : null;
    if (request) setQueued(request);
  }, [tried]);
  useEffect(() => {
    if (panel || !queued) return;
    setPlay((last) => ({ key: (last?.key ?? 0) + 1, request: queued }));
    setQueued(null);
  }, [panel, queued]);

  // Focus moves into the panel when it opens or changes, so keyboard and screen reader users land in it.
  useEffect(() => {
    if (!panel || !dialog.current) return;
    const first = dialog.current.querySelector<HTMLElement>("select, input:not([type=hidden]), textarea, button:not(.vh-close), a");
    (first ?? dialog.current).focus();
  }, [panel, ranId]);

  // Keys stay inside the panel: the village's own shortcuts (1 2 3, A, R, ...) listen on window.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab" || !dialog.current) return;
    const focusable = [...dialog.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([type=hidden]), select, textarea")];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const title = panel === "desk" ? "The human desk" : ranId ? "What happened" : "The Inbox";

  return (
    <main className="village-home">
      <header className="vh-top">
        <p className="vh-name">Approval Desk</p>
        <p className="vh-what">
          A refund agent for an invented shop: the AI suggests, plain code decides, a person signs off on the big ones.{" "}
          <a href={GITHUB}>Code on GitHub</a>
        </p>
      </header>

      <VillageCanvas onPlace={openPlace} play={play} />

      <section className="vh-note" aria-label="About this page">
        <p>
          The stories playing above are made up. <strong>Your requests are real:</strong> click the{" "}
          <button type="button" className="vh-link" onClick={() => openPlace("inbox")}>
            Inbox stand
          </button>{" "}
          (key I) to write one, and the real agent reads it. Click the{" "}
          <button type="button" className="vh-link" onClick={() => openPlace("desk")}>
            human desk
          </button>{" "}
          (key H) to see yours waiting for a person.
        </p>
        <p className="vh-more">
          <Link href="/approvals">Approval screen</Link> · <Link href="/try">Try page</Link>
        </p>
      </section>

      {panel ? (
        <div className="vh-backdrop" onClick={(e) => e.target === e.currentTarget && close()}>
          <div
            ref={dialog}
            className="vh-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="vh-panel-title"
            tabIndex={-1}
            onKeyDown={onKeyDown}
          >
            <div className="vh-panel-bar">
              <h2 id="vh-panel-title">{title}</h2>
              <button type="button" className="vh-close" onClick={close} aria-label="Close and go back to the village">
                ✕
              </button>
            </div>
            <div className="vh-panel-body">
              {panel === "desk" ? (
                <DeskPanel waiting={waiting} toInbox={() => setPanel("inbox")} />
              ) : problem ? (
                <p className="problem" role="alert">
                  {problem}
                </p>
              ) : ranId ? (
                <Result tried={tried} onAnother={another} onWatch={close} />
              ) : (
                <>
                  <p className="vh-lede">
                    Write a refund request as one of the shop&apos;s customers. The real agent reads it, the gate checks its
                    answer, and it ends up paid, waiting for a person, or blocked. Try to break it.
                  </p>
                  <TryForm key={formKey} customers={customers} limits={limits} onRan={setRanId} className="vh-try try-form" />
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
