"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { approveAndPay, rejectRequest, retryPayment, type Decision } from "../../lib/approval.ts";
import { appDb } from "./db.ts";

// What each form gets back when a person's decision is refused: the reason, in
// plain words. When the decision goes through, the page reloads with a banner.
export type FormState = { error: string | null };

function finish(decision: Decision): FormState {
  if (!decision.ok) return { error: decision.message };
  revalidatePath("/approvals");
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
  return withDb((db) => finish(approveAndPay(db, gateEntryId, { orderId: text(formData, "orderId"), amount: text(formData, "amount") })));
}

export async function rejectAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const gateEntryId = entryId(formData, "gateEntryId");
  if (gateEntryId === null) return { error: "That request could not be found" };
  return withDb((db) => finish(rejectRequest(db, gateEntryId, text(formData, "note"))));
}

export async function retryAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const approvalEntryId = entryId(formData, "approvalEntryId");
  if (approvalEntryId === null) return { error: "That approval could not be found" };
  return withDb((db) => finish(retryPayment(db, approvalEntryId)));
}
