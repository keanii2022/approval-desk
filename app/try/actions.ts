"use server";

import { redirect } from "next/navigation";
import { askClaude } from "../../lib/claude.ts";
import { tryInputProblem, tryRequest } from "../../lib/tryout.ts";
import { appDb } from "../approvals/db.ts";

export type TryState = { error: string | null };

const text = (formData: FormData, field: string) => String(formData.get(field) ?? "");

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
    ({ requestId } = await tryRequest(db, input, askClaude));
  } finally {
    db.close();
  }
  redirect(`/try?ran=${requestId}`);
}
