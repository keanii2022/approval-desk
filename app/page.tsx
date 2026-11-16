import { cookies } from "next/headers";
import { getWaitingCases } from "../lib/approval.ts";
import type { ReceiptCustomer } from "../lib/try-fields.ts";
import { customerReceipts, MESSAGE_MAX, NAME_MAX, recentTries, SUBJECT_MAX } from "../lib/tryout.ts";
import { readVisitorId, VISITOR_COOKIE } from "../lib/visitor.ts";
import { appDb } from "./approvals/db.ts";
import VillageHome from "./village/VillageHome.tsx";
import { tryView, waitingViews, type TryView, type WaitingView } from "./village/views.ts";

export const dynamic = "force-dynamic";

// The front door: the village plays its scripted stories, and the Inbox and the human desk
// open panels with the visitor's own, real requests.
export default async function Home() {
  const visitor = readVisitorId((await cookies()).get(VISITOR_COOKIE)?.value);
  let customers: ReceiptCustomer[] = [];
  let tries: TryView[] = [];
  let waiting: WaitingView[] = [];
  let problem: string | null = null;
  try {
    const db = appDb();
    try {
      customers = customerReceipts(db);
      tries = recentTries(db, visitor).map(tryView);
      waiting = visitor ? waitingViews(getWaitingCases(db, visitor)) : [];
    } finally {
      db.close();
    }
  } catch {
    problem = "The shop data couldn't be read. If it isn't set up yet, run npm run seed, then reload this page.";
  }
  return (
    <VillageHome
      customers={customers}
      tries={tries}
      waiting={waiting}
      problem={problem}
      limits={{ subjectMax: SUBJECT_MAX, messageMax: MESSAGE_MAX, nameMax: NAME_MAX }}
    />
  );
}
