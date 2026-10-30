// The Human Desk: the approval screen as a first-person stop in Approval Desk
// Village. The chrome (header, stage, console rail, dialogue bar, device strip)
// comes from app/village/ui.tsx; this page only fills it with the live queue.
// The screen stays a thin layer over lib/approval.ts, and every decision still
// goes through the server actions in actions.ts. Nothing here changes an order.
import { approvedNotPaid, getWaitingCases, type WaitingCase } from "../../lib/approval.ts";
import { appDb } from "./db.ts";
import {
  ConsoleRail,
  DeviceStrip,
  DialogueAction,
  DialogueBar,
  EncounterIndicator,
  HumanPortrait,
  IdentityChip,
  Scene,
  Stage,
  VillageShell,
} from "../village/ui.tsx";
import { CasePanel, EmptyPanel, Problem, SectionTitle, UnpaidPanel } from "./DeskConsole.tsx";
import Keys from "./Keys.tsx";
import RailScroll from "./RailScroll.tsx";
import "./approvals.css";

export const metadata = { title: "Human desk | Approval Desk" };
export const dynamic = "force-dynamic"; // always read the queue fresh

// What the desk keeper says after a decision: the sentence (exactly as the tests
// read it) and the short headline above it. Maps, so a stray ?result= can't reach
// anything that isn't a banner.
const BANNERS = new Map([
  ["rejected", "Rejected. Nothing was paid."],
  ["already_paid", "That refund was already paid. Nothing more was done."],
  ["unpaid", "Your approval is on record, but NOTHING was paid. See “Approved but not paid” below."],
]);
const HEADLINES = new Map([
  ["paid", "Approved and paid."],
  ["rejected", "Rejected."],
  ["already_paid", "Already paid."],
  ["unpaid", "Approval on record, nothing paid."],
]);

const STANDING_LINE =
  "You decide. Nothing is paid until you approve, and no one, including you, can refund more than was paid or refund someone else’s order.";

function countHeadline(waiting: number): string {
  if (waiting === 0) return "Nothing waits for you.";
  if (waiting === 1) return "1 refund waits for you.";
  return `${waiting} refunds wait for you.`;
}

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ result?: string; refund?: string }> }) {
  const { result, refund } = await searchParams;
  let cases: WaitingCase[] = [];
  let unpaid: ReturnType<typeof approvedNotPaid> = [];
  let problem: string | null = null;
  let refundIsReal = false;
  try {
    const db = appDb();
    try {
      cases = getWaitingCases(db);
      unpaid = approvedNotPaid(db);
      // The banner only claims a payment that is really in the shop's refunds.
      refundIsReal = Boolean(refund && db.prepare("SELECT 1 FROM refunds WHERE id = ?").get(refund));
    } finally {
      db.close();
    }
  } catch {
    problem = "The shop data couldn't be read. If it isn't set up yet, run npm run seed, then reload this page.";
  }

  const banner =
    result === "paid" ? (refundIsReal ? `Approved and paid. Refund ${refund} is done.` : undefined) : result ? BANNERS.get(result) : undefined;
  const headline = banner ? HEADLINES.get(result ?? "") : problem ? "The desk can't reach the shop data." : countHeadline(cases.length);
  const waiting = String(cases.length).padStart(2, "0");

  return (
    <VillageShell chapter="The human desk" activeStage="human-desk" shortcut={{ keyCap: "B", label: "Back to village", count: waiting, href: "/village" }}>
      <div className="human-desk">
        <Keys />
        <RailScroll stamp={result ? `${result}|${cases.length}|${unpaid.length}` : null} />
        <Stage label="Human desk encounter">
          <Scene placeName="Human desk" placeNumber="04" currentPlace="human-desk">
            <IdentityChip>{cases.length > 0 ? `Human desk · ${cases.length} waiting` : "Human desk · nothing waiting"}</IdentityChip>
          </Scene>
          <ConsoleRail label="Human desk console">
            <EncounterIndicator>Human desk encounter</EncounterIndicator>
            {problem && <Problem inRail>{problem}</Problem>}

            {unpaid.length > 0 && (
              <>
                <SectionTitle tone="red">Approved but not paid ({unpaid.length})</SectionTitle>
                {unpaid.map((u) => (
                  <UnpaidPanel key={u.approvalEntryId} unpaid={u} />
                ))}
              </>
            )}

            <SectionTitle>Waiting for you ({cases.length})</SectionTitle>
            {!problem && cases.length === 0 && <EmptyPanel />}
            {cases.map((c) => (
              <CasePanel key={c.gateEntryId} c={c} />
            ))}
          </ConsoleRail>
        </Stage>

        <DialogueBar
          portrait={<HumanPortrait />}
          speakerName="Desk keeper"
          speakerLabel="The human desk"
          subLabel="Your call"
          headline={headline}
          body={
            banner ? (
              <span role="status" className={result === "unpaid" ? "hd-banner hd-banner--warn" : "hd-banner"}>
                {banner}
              </span>
            ) : (
              STANDING_LINE
            )
          }
          actions={
            <>
              <DialogueAction variant="primary" keyCap="B" label="Back to village" href="/village" />
              <DialogueAction variant="secondary" keyCap="Esc" label="Menu" href="/" />
            </>
          }
        />
        <DeviceStrip motto="Agent suggests. Gate decides. You decide the big ones. Factory pays." right="Human desk · live data" />
      </div>
    </VillageShell>
  );
}
