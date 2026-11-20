"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { askClaude } from "../../lib/claude.ts";
import { utcNow } from "../../lib/pipeline.ts";
import { standInAgent } from "../../lib/stand-in-agent.ts";
import { tryInputProblem, tryRequest } from "../../lib/tryout.ts";
import { networkKey, spendingProblem } from "../../lib/visitor.ts";
import { countsDb, visitorShop } from "../approvals/db.ts";

// ranId is set only when the form asked to stay on its page (the village panel) instead of going to /try.
export type TryState = { error: string | null; ranId?: string };

// Browser tests set AGENT_STAND_IN=1 so a sent request never reaches the real AI. Production never sets it.
const agent = () => (process.env.AGENT_STAND_IN === "1" ? standInAgent : askClaude);

const text = (formData: FormData, field: string) => String(formData.get(field) ?? "");

export async function tryAction(_previous: TryState, formData: FormData): Promise<TryState> {
  const input = {
    customerId: text(formData, "customerId"),
    subject: text(formData, "subject"),
    message: text(formData, "message"),
    newName: text(formData, "newName"),
  };
  let shop;
  try {
    shop = await visitorShop();
  } catch {
    return { error: "The shop data isn't set up yet. Run npm run seed, then try again." };
  }
  const { db } = shop;
  let requestId;
  try {
    const problem = tryInputProblem(db, input);
    if (problem) return { error: problem };
    const counts = countsDb();
    try {
      const network = networkKey((await headers()).get("x-forwarded-for"));
      const visit = { visitorId: shop.visitorId, now: utcNow(), counts, network };
      const overLimit = spendingProblem(counts, visit.visitorId, visit.now, undefined, network);
      if (overLimit) return { error: overLimit };
      ({ requestId } = await tryRequest(db, input, agent(), visit));
    } finally {
      counts.close();
    }
  } finally {
    db.close();
  }
  if (formData.get("stay") === "1") {
    refresh(); // the page around the panel re-reads the visitor's tries and waiting requests
    return { error: null, ranId: requestId };
  }
  redirect("/");
}
