"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { askClaude } from "../../lib/claude.ts";
import { utcNow } from "../../lib/pipeline.ts";
import { standInAgent } from "../../lib/stand-in-agent.ts";
import { tryInputProblem, tryRequest } from "../../lib/tryout.ts";
import { newVisitorId, readVisitorId, spendingProblem, VISITOR_COOKIE, VISITOR_COOKIE_MAX_AGE } from "../../lib/visitor.ts";
import { appDb } from "../approvals/db.ts";

// ranId is set only when the form asked to stay on its page (the village panel) instead of going to /try.
export type TryState = { error: string | null; ranId?: string };

// Browser tests set AGENT_STAND_IN=1 so a sent request never reaches the real AI. Production never sets it.
const agent = () => (process.env.AGENT_STAND_IN === "1" ? standInAgent : askClaude);

const text = (formData: FormData, field: string) => String(formData.get(field) ?? "");

// Cookies can only be set in a server action, so a visitor gets their ID on their first try.
async function visitorId(): Promise<string> {
  const store = await cookies();
  const existing = readVisitorId(store.get(VISITOR_COOKIE)?.value);
  if (existing) return existing;
  const id = newVisitorId();
  store.set(VISITOR_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: VISITOR_COOKIE_MAX_AGE,
    path: "/",
  });
  return id;
}

export async function tryAction(_previous: TryState, formData: FormData): Promise<TryState> {
  const input = {
    customerId: text(formData, "customerId"),
    subject: text(formData, "subject"),
    message: text(formData, "message"),
    newName: text(formData, "newName"),
  };
  let db;
  try {
    db = appDb();
  } catch {
    return { error: "The shop data isn't set up yet. Run npm run seed, then try again." };
  }
  let requestId;
  try {
    const problem = tryInputProblem(db, input);
    if (problem) return { error: problem };
    const visit = { visitorId: await visitorId(), now: utcNow() };
    const overLimit = spendingProblem(db, visit.visitorId, visit.now);
    if (overLimit) return { error: overLimit };
    ({ requestId } = await tryRequest(db, input, agent(), visit));
  } finally {
    db.close();
  }
  if (formData.get("stay") === "1") {
    refresh(); // the page around the panel re-reads the visitor's tries and waiting requests
    return { error: null, ranId: requestId };
  }
  redirect(`/try?ran=${requestId}`);
}
