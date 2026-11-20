"use server";

import { refresh, revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { approveAndPay, rejectRequest, retryPayment, type Decision } from "../../lib/approval.ts";
import { utcNow } from "../../lib/pipeline.ts";
import { readVisitorId, VISITOR_COOKIE } from "../../lib/visitor.ts";
import { appDb } from "./db.ts";

async function currentVisitor(): Promise<string | null> {
  return readVisitorId((await cookies()).get(VISITOR_COOKIE)?.value);
}

// What each form gets back when a person's decision is refused: the reason, in
// plain words. When the decision goes through, the page reloads with a banner.
// From the village, the form stays on the page and gets back what happened instead.
export type Decided = { outcome: "paid" | "already_paid" | "rejected" | "approved_not_paid"; amountCents: number | null };
export type FormState = { error: string | null; done?: Decided };

function finish(decision: Decision, stay = false, amountCents: number | null = null): FormState {
  if (!decision.ok) return { error: decision.message };
  revalidatePath("/approvals");
  if (stay) {
    refresh(); // the village around the panel re-reads the visitor's waiting requests
    return { error: null, done: { outcome: decision.outcome, amountCents } };
  }
  const result =
    decision.outcome === "paid"
      ? `paid&refund=${decision.refundId}`
      : decision.outcome === "rejected"
        ? "rejected"
        : decision.outcome === "already_paid"
          ? "already_paid"
          : "unpaid";
  redirect(`/approvals?result=${result}`);
}

const NO_DATABASE: FormState = { error: "The shop data isn't set up yet. Run npm run seed, then try again." };

// Opens the database for one decision, and always closes it.
function withDb(run: (db: ReturnType<typeof appDb>) => FormState): FormState {
  let db;
  try {
    db = appDb();
  } catch {
    return NO_DATABASE;
  }
  try {
    return run(db);
  } finally {
    db.close();
  }
}

function entryId(formData: FormData, field: string): number | null {
  const value = Number(formData.get(field));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

const text = (formData: FormData, field: string) => String(formData.get(field) ?? "");

export async function approveAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const gateEntryId = entryId(formData, "gateEntryId");
  if (gateEntryId === null) return { error: "That request could not be found" };
  const visitor = await currentVisitor();
  const input = { orderId: text(formData, "orderId"), amount: text(formData, "amount") };
  const cents = Math.round(Number(input.amount) * 100);
  const stay = formData.get("stay") === "1";
  return withDb((db) => finish(approveAndPay(db, gateEntryId, input, utcNow(), visitor), stay, Number.isFinite(cents) ? cents : null));
}

export async function rejectAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const gateEntryId = entryId(formData, "gateEntryId");
  if (gateEntryId === null) return { error: "That request could not be found" };
  const visitor = await currentVisitor();
  const stay = formData.get("stay") === "1";
  return withDb((db) => finish(rejectRequest(db, gateEntryId, text(formData, "note"), utcNow(), visitor), stay));
}

export async function retryAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const approvalEntryId = entryId(formData, "approvalEntryId");
  if (approvalEntryId === null) return { error: "That approval could not be found" };
  const visitor = await currentVisitor();
  return withDb((db) => finish(retryPayment(db, approvalEntryId, utcNow(), visitor)));
}
