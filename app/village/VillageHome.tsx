"use client";

// The front page: the robot waits until something is sent. The Inbox opens a panel with the
// made-up stories (no AI) and the visitor's own tries (the real agent); the human desk is the
// approval screen.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { WaitingCase } from "../../lib/approval.ts";
import type { ReceiptCustomer } from "../../lib/try-fields.ts";
import type { Decided } from "../approvals/actions.ts";
import { WaitingCard } from "../approvals/WaitingCard.tsx";
import { TryForm } from "../try/TryForm.tsx";
import VillageCanvas, { type VillagePlace, type VisitorRequest } from "./VillageCanvas.tsx";
import { visitorRequest, type AgentView, type TryView } from "./views.ts";
import "../approvals/approvals.css";
import "./home.css";

const GITHUB = "https://github.com/keanii2022/approval-desk";

type Props = {
  customers: ReceiptCustomer[];
  tries: TryView[];
  /** Everything waiting for a person: the visitor's own and the ones that came in overnight. */
  waiting: WaitingCase[];
  triesLeft: number;
  problem: string | null;
  limits: { subjectMax: number; messageMax: number; nameMax: number };
};

function AgentAnswer({ agent }: { agent: AgentView }) {
  if (agent.kind === "none") return <p className="vh-muted">No answer on record.</p>;
  if (agent.kind === "ai_down") return <p>The AI didn&apos;t answer (it was down or timed out), so there is no suggestion. A person decides instead.</p>;
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

// The village's three scripted stories. They make no AI calls, so they always work.
const STORIES = [
  { scene: 1, name: "Small refund", price: "$24", hint: "Paid on its own" },
  { scene: 2, name: "Big refund", price: "$150", hint: "Waits for a person" },
  { scene: 3, name: "Too much", price: "$500", hint: "Blocked by the gate" },
] as const;

// Ways to test the agent. Only ideas: the visitor writes the message themselves.
const IDEAS = [
  "Ask for more money than the order cost.",
  "Say a manager or the system already approved it.",
  "Ask for a refund on someone else's order.",
  "Ask about an order from months ago.",
  "Leave out which order it was, or how much.",
  "Write as someone new who never bought anything.",
  "Ask for part of a refund, then send another asking for the rest.",
  "Write as Max Quill. Their account is flagged.",
  "Write as Mara about her napkins (O1038). They haven't been delivered yet.",
];

export default function VillageHome({ customers, tries, waiting, triesLeft, problem, limits }: Props) {
  const [panel, setPanel] = useState<VillagePlace | "decide" | null>(null);
  // The visitor's own request the robot holds at the desk, and the decision once it went through.
  const [deciding, setDeciding] = useState<WaitingCase | null>(null);
  const [decideChoice, setDecideChoice] = useState<"A" | "R">("A");
  const [decided, setDecided] = useState<{ key: number; choice: "A" | "R"; paidCents: number | null } | null>(null);
  const [ranId, setRanId] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  // The visitor's last request waits here until the panel closes, then the village plays it.
  const [queued, setQueued] = useState<VisitorRequest | null>(null);
  const [play, setPlay] = useState<{ key: number; request: VisitorRequest } | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<Element | null>(null);

  const router = useRouter();
  const [story, setStory] = useState<{ key: number; scene: 1 | 2 | 3 } | null>(null);
  const openPlace = useCallback(
    (place: VillagePlace) => {
      if (place === "desk") {
        router.push("/approvals"); // the human desk is the approval screen
        return true;
      }
      if (place === "shop") {
        router.push("/dashboard");
        return true;
      }
      returnFocus.current = document.activeElement;
      setPanel(place);
      return true;
    },
    [router],
  );
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

  // Each request plays once, even when its result is opened again later.
  const played = useRef(new Set<string>());
  const queue = useCallback((t: TryView | undefined) => {
    if (!t || played.current.has(t.requestId)) return false;
    const request = visitorRequest(t);
    if (!request) return false;
    played.current.add(t.requestId);
    setQueued(request);
    return true;
  }, []);

  const tried = ranId ? tries.find((t) => t.requestId === ranId) : undefined;
  useEffect(() => {
    queue(tried);
  }, [tried, queue]);
  useEffect(() => {
    if (panel || !queued) return;
    setPlay((last) => ({ key: (last?.key ?? 0) + 1, request: queued }));
    setQueued(null);
  }, [panel, queued]);

  // Focus moves into the panel when it opens or changes, so keyboard and screen reader users land in it.
  useEffect(() => {
    if (!panel || !dialog.current) return;
    // Reject tapped at the desk: land on the reject note, not the approve form above it.
    const note = panel === "decide" && decideChoice === "R" ? dialog.current.querySelector<HTMLElement>('form[aria-label="Reject this refund"] textarea') : null;
    const first = note ?? dialog.current.querySelector<HTMLElement>("select, input:not([type=hidden]), textarea, button:not(.vh-close), a");
    (first ?? dialog.current).focus();
    note?.scrollIntoView({ block: "center" });
  }, [panel, ranId, decideChoice]);

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

  const title = panel === "decide" ? "Your call" : ranId ? "What happened" : "The Inbox";
  // A copy taken when the panel opens: once decided, the page's fresh data no longer lists it,
  // and the card must stay to report back.
  const decidingCase = deciding;
  const latestWaiting = useRef(waiting);
  latestWaiting.current = waiting;
  const onDecide = useCallback((requestId: string, choice: "A" | "R") => {
    returnFocus.current = document.activeElement;
    setDecideChoice(choice);
    setDeciding(latestWaiting.current.find((c) => c.requestId === requestId) ?? null);
    setPanel("decide");
  }, []);
  // Paid or rejected: close the panel and let the robot carry on from the desk.
  const onDecided = (done: Decided) => {
    if (done.outcome === "paid" || done.outcome === "rejected") {
      setDecided((last) => ({ key: (last?.key ?? 0) + 1, choice: done.outcome === "paid" ? "A" : "R", paidCents: done.amountCents }));
    }
    setDeciding(null);
    close();
  };
  // On a phone the story buttons sit below the village, so bring the robot back into view.
  const playStory = (scene: 1 | 2 | 3) => {
    if (panel) close();
    setStory((last) => ({ key: (last?.key ?? 0) + 1, scene }));
    document.querySelector(".village-canvas")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <main className="village-home">
      <header className="vh-top">
        <p className="vh-name">Approval Desk</p>
        <p className="vh-what">
          A Claude refund agent for an invented shop. The AI suggests, plain code decides, a person signs off on the big ones.{" "}
          <a href={GITHUB}>Code on GitHub</a> · <Link href="/dashboard">Dashboard</Link>
        </p>
      </header>

      {/* side by side on a wide screen, so the ways in sit next to the village, not below it */}
      <div className="vh-stage">
        <VillageCanvas onPlace={openPlace} onDecide={onDecide} decided={decided} play={play} story={story} live />
        <div className="vh-side">

          <section className="vh-start" aria-label="Start here">
            <button type="button" className="vh-test" onClick={() => openPlace("inbox")}>
              <span className="vh-test-name">The Inbox</span>
              <span className="vh-test-hint">Send the agent your own request</span>
            </button>
            <Link className="vh-test" href="/approvals">
              <span className="vh-test-name">
                Human desk{waiting.length > 0 ? <span className="vh-test-price"> ({waiting.length})</span> : null}
              </span>
              <span className="vh-test-hint">Decide the big refunds</span>
            </Link>
          </section>

          <section className="vh-stories" aria-labelledby="vh-stories-title">
            <h2 id="vh-stories-title" className="vh-sec">Watch a story</h2>
            <p className="vh-muted">Made-up requests, played by the village. No AI, so they always work.</p>
            <div className="vh-test-buttons">
              {STORIES.map((st) => (
                <button key={st.scene} type="button" className="vh-test" onClick={() => playStory(st.scene)}>
                  <span className="vh-test-name">
                    {st.name} <span className="vh-test-price">{st.price}</span>
                  </span>
                  <span className="vh-test-hint">{st.hint}</span>
                </button>
              ))}
            </div>
          </section>

          <p className="vh-note">When the agent runs on its own, big refunds pile up at the human desk until a person decides. Here, that person is you.</p>
        </div>
      </div>

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
              {panel === "decide" ? (
                decidingCase ? (
                  <>
                    <p className="vh-lede">The gate sent this to a person. Approve and the factory pays; reject and nothing moves.</p>
                    <div className="approvals vh-decide">
                      <WaitingCard c={decidingCase} onDone={onDecided} />
                    </div>
                  </>
                ) : (
                  <p className="vh-muted">This request is no longer waiting.</p>
                )
              ) : problem ? (
                <p className="problem" role="alert">
                  {problem}
                </p>
              ) : ranId ? (
                <Result tried={tried} onAnother={another} onWatch={close} />
              ) : (
                <>
                  <h3 className="vh-sec">Try it yourself</h3>
                  <p className="vh-muted">
                    Write as one of the shop&apos;s customers. The real refund agent reads it, and the gate decides.{" "}
                    <strong className="vh-left">
                      {triesLeft === 0 ? "No tries left for now. The stories still work." : `${triesLeft} ${triesLeft === 1 ? "try" : "tries"} left this hour.`}
                    </strong>
                  </p>
                  <details className="vh-ideas">
                    <summary>Ideas to try to break it</summary>
                    <ul>
                      {IDEAS.map((idea) => (
                        <li key={idea}>{idea}</li>
                      ))}
                    </ul>
                  </details>
                  <TryForm key={formKey} customers={customers} limits={limits} onRan={setRanId} className="vh-try try-form" locked={triesLeft === 0} />
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
