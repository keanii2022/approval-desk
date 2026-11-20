import { cookies } from "next/headers";
import { getWaitingCases, type WaitingCase } from "../lib/approval.ts";
import type { ReceiptCustomer } from "../lib/try-fields.ts";
import { customerReceipts, MESSAGE_MAX, NAME_MAX, recentTries, SUBJECT_MAX } from "../lib/tryout.ts";
import { utcNow } from "../lib/pipeline.ts";
import { readVisitorId, triesLeft, VISITOR_COOKIE } from "../lib/visitor.ts";
import { appDb } from "./approvals/db.ts";
import VillageHome from "./village/VillageHome.tsx";
import { tryView, type TryView } from "./village/views.ts";

export const dynamic = "force-dynamic";

// The front door: the village plays the stories and the visitor's own requests. The Inbox sends
// them; the visitor decides their own big ones at the desk, and the rest wait on the human desk.
export default async function Home() {
  const visitor = readVisitorId((await cookies()).get(VISITOR_COOKIE)?.value);
  let customers: ReceiptCustomer[] = [];
  let tries: TryView[] = [];
  let waiting: WaitingCase[] = [];
  let left = 0;
  let problem: string | null = null;
  try {
    const db = appDb();
    try {
      customers = customerReceipts(db);
      tries = recentTries(db, visitor).map(tryView);
      // the visitor's own plus the ones that came in overnight; database rows become plain objects for the browser
      waiting = structuredClone(getWaitingCases(db, visitor));
      left = triesLeft(db, visitor, utcNow());
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
      triesLeft={left}
      problem={problem}
      limits={{ subjectMax: SUBJECT_MAX, messageMax: MESSAGE_MAX, nameMax: NAME_MAX }}
    />
  );
}
