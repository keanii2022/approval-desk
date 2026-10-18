import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { expect, test, type Locator, type Page } from "@playwright/test";

// The approval screen, in a real browser. Before each test the database is rebuilt
// with three requests waiting for a person (a stand-in agent, no AI calls):
//   REQ-002 Theo   $150.00 on O1002: over $100 (R2)
//   REQ-005 Ines   $42.00 on O1005: the order is 45 days old (R3)
//   REQ-018 Arjun  the AI was down, so the person picks the order (R6)
const DB = "data/e2e.db";

test.beforeEach(() => {
  execFileSync("node", ["scripts/prepare-queue.ts", DB], { stdio: "pipe" });
});

function rows(sql: string): Record<string, unknown>[] {
  const db = new DatabaseSync(DB, { readOnly: true });
  try {
    return db.prepare(sql).all() as Record<string, unknown>[];
  } finally {
    db.close();
  }
}
const newRefunds = () => rows("SELECT id, order_id, amount_cents FROM refunds WHERE id > 'RF015' ORDER BY id");
const decisions = () => rows("SELECT details FROM logbook WHERE kind = 'human_decision' ORDER BY id").map((r) => JSON.parse(String(r.details)));

// Clicks a button and waits until the server has answered, so what is checked next is what really happened.
async function press(page: Page, button: Locator) {
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), button.click()]);
}

const card = (page: Page, requestId: string) => page.getByRole("article", { name: new RegExp(requestId) });

test("Approval screen: shows what a person needs: the message, why, what the agent said, and what was paid and what is left", async ({ page }) => {
  await page.goto("/approvals");
  await expect(page.getByRole("heading", { name: "Waiting for you (3)" })).toBeVisible();

  const theo = card(page, "REQ-002");
  await expect(theo).toContainText("Theo Achterberg");
  await expect(theo).toContainText("walnut desk lamp");
  await expect(theo).toContainText("The refund is over $100");
  await expect(theo).toContainText("Suggested a refund of $150.00 on O1002");
  const order = theo.getByRole("row", { name: /O1002/ });
  await expect(order).toContainText("$150.00"); // what the customer paid
  await expect(order).toContainText("$0.00"); // already refunded
  await expect(theo.getByLabel(/Refund amount/)).toHaveValue("150.00");

  await expect(card(page, "REQ-005")).toContainText("The order is more than 30 days old");
  await expect(card(page, "REQ-018")).toContainText("The AI was unavailable");
});

test("Approval screen: approve: the refund is paid, the request leaves the queue, and it is in the logbook (REQ-002)", async ({ page }) => {
  await page.goto("/approvals");
  await press(page, card(page, "REQ-002").getByRole("button", { name: "Approve and pay" }));

  await expect(page.getByRole("status")).toHaveText("Approved and paid. Refund RF016 is done.");
  await expect(page.getByRole("heading", { name: "Waiting for you (2)" })).toBeVisible();
  await expect(card(page, "REQ-002")).toHaveCount(0);

  expect(newRefunds()).toEqual([{ id: "RF016", order_id: "O1002", amount_cents: 15000 }]);
  expect(decisions()).toEqual([{ decision: "approve", orderId: "O1002", amountCents: 15000 }]);
});

test("Approval screen: change the amount: a person can approve less than the agent suggested (REQ-002, $120.00)", async ({ page }) => {
  await page.goto("/approvals");
  const theo = card(page, "REQ-002");
  await theo.getByLabel(/Refund amount/).fill("120.00");
  await press(page, theo.getByRole("button", { name: "Approve and pay" }));

  await expect(page.getByRole("status")).toContainText("Refund RF016");
  expect(newRefunds()).toEqual([{ id: "RF016", order_id: "O1002", amount_cents: 12000 }]);
});

test("Approval screen: reject without a note is refused, and nothing changes (REQ-002)", async ({ page }) => {
  await page.goto("/approvals");
  const theo = card(page, "REQ-002");
  await press(page, theo.getByRole("button", { name: "Reject" }));

  await expect(theo.getByRole("alert")).toHaveText("A note is required to reject a refund");
  await expect(theo).toBeVisible(); // still waiting
  await expect(page.getByRole("heading", { name: "Waiting for you (3)" })).toBeVisible();

  // A note of only spaces is the same as no note.
  await theo.getByLabel(/Why are you rejecting/).fill("    ");
  await press(page, theo.getByRole("button", { name: "Reject" }));
  await expect(theo.getByRole("alert")).toHaveText("A note is required to reject a refund");

  expect(decisions()).toEqual([]);
  expect(newRefunds()).toEqual([]);
});

test("Approval screen: reject with a note: nothing is paid, the request leaves the queue, and the note is saved (REQ-002)", async ({ page }) => {
  await page.goto("/approvals");
  const theo = card(page, "REQ-002");
  await theo.getByLabel(/Why are you rejecting/).fill("The lamp was used for a month");
  await press(page, theo.getByRole("button", { name: "Reject" }));

  await expect(page.getByRole("status")).toHaveText("Rejected. Nothing was paid.");
  await expect(card(page, "REQ-002")).toHaveCount(0);
  expect(decisions()).toEqual([{ decision: "reject", note: "The lamp was used for a month" }]);
  expect(newRefunds()).toEqual([]);
});

test("R1: an amount over what is left on the order is refused, and nothing changes (REQ-002, $150.01)", async ({ page }) => {
  await page.goto("/approvals");
  const theo = card(page, "REQ-002");
  await theo.getByLabel(/Refund amount/).fill("150.01");
  await press(page, theo.getByRole("button", { name: "Approve and pay" }));

  await expect(theo.getByRole("alert")).toContainText("more than what is left on this order");
  await expect(theo.getByRole("alert")).toContainText("$150.00");
  await expect(theo).toBeVisible();

  expect(decisions()).toEqual([]);
  expect(newRefunds()).toEqual([]);
});

test("Approval screen: an amount that isn't a clear dollar amount is refused (REQ-002)", async ({ page }) => {
  await page.goto("/approvals");
  const theo = card(page, "REQ-002");
  for (const bad of ["", "abc", "12.345", "-5"]) {
    await theo.getByLabel(/Refund amount/).fill(bad);
    await press(page, theo.getByRole("button", { name: "Approve and pay" }));
    await expect(theo.getByRole("alert")).toHaveText("Enter an amount in dollars, like 150.00");
  }
  expect(newRefunds()).toEqual([]);
});

test("R8: when the AI was down, a person can only pick the asking customer's own orders (REQ-018)", async ({ page }) => {
  await page.goto("/approvals");
  const arjun = card(page, "REQ-018");

  await expect(arjun.getByRole("radio")).toHaveCount(2);
  await expect(arjun.getByRole("radio", { name: "O1030" })).toBeVisible();
  await expect(arjun.getByRole("radio", { name: "O1031" })).toBeVisible();
  await expect(arjun).not.toContainText("O1001"); // someone else's order is never offered
  await expect(page.locator("main")).toContainText("Customer paid"); // the columns a person decides with
});

test("R1 on a picked order: $27.01 on a $27.00 order is refused, $27.00 is paid (REQ-018, O1030)", async ({ page }) => {
  await page.goto("/approvals");
  const arjun = card(page, "REQ-018");
  await arjun.getByRole("radio", { name: "O1030" }).check();
  await arjun.getByLabel(/Refund amount/).fill("27.01");
  await press(page, arjun.getByRole("button", { name: "Approve and pay" }));
  await expect(arjun.getByRole("alert")).toContainText("The most you can refund is $27.00");
  expect(newRefunds()).toEqual([]);

  await arjun.getByLabel(/Refund amount/).fill("27.00");
  await press(page, arjun.getByRole("button", { name: "Approve and pay" }));
  await expect(page.getByRole("status")).toContainText("Refund RF016");
  expect(newRefunds()).toEqual([{ id: "RF016", order_id: "O1030", amount_cents: 2700 }]);
});

test("Approval screen: picking no order is refused (REQ-018)", async ({ page }) => {
  await page.goto("/approvals");
  const arjun = card(page, "REQ-018");
  await arjun.getByLabel(/Refund amount/).fill("10");
  await press(page, arjun.getByRole("button", { name: "Approve and pay" }));
  await expect(arjun.getByRole("alert")).toHaveText("Pick an order");
  expect(newRefunds()).toEqual([]);
});

test("Approval screen: when nothing is waiting, the page says so", async ({ page }) => {
  await page.goto("/approvals");
  for (const id of ["REQ-002", "REQ-005"]) {
    await card(page, id).getByLabel(/Why are you rejecting/).fill("No");
    await press(page, card(page, id).getByRole("button", { name: "Reject" }));
    await expect(card(page, id)).toHaveCount(0);
  }
  await card(page, "REQ-018").getByLabel(/Why are you rejecting/).fill("No");
  await press(page, card(page, "REQ-018").getByRole("button", { name: "Reject" }));
  await expect(page.getByText("Nothing is waiting for you.")).toBeVisible();
});

test("Approval screen: an approval the executor can't pay is shown as unpaid, and can be paid again once the problem is fixed (REQ-002)", async ({ page }) => {
  const db = new DatabaseSync(DB);
  db.exec("CREATE TRIGGER e2e_no_payment BEFORE INSERT ON logbook WHEN NEW.kind = 'refund_done' BEGIN SELECT RAISE(ABORT, 'no payments'); END");
  db.close();

  await page.goto("/approvals");
  await press(page, card(page, "REQ-002").getByRole("button", { name: "Approve and pay" }));
  await expect(page.getByRole("status")).toContainText("NOTHING was paid");
  await expect(page.getByRole("heading", { name: "Approved but not paid (1)" })).toBeVisible();
  await expect(page.getByText("because the logbook couldn't write it down")).toBeVisible();
  await expect(card(page, "REQ-002")).toHaveCount(0); // a person's decision counts once
  expect(newRefunds()).toEqual([]);

  const fix = new DatabaseSync(DB);
  fix.exec("DROP TRIGGER e2e_no_payment");
  fix.close();
  await press(page, page.getByRole("button", { name: "Try paying again" }));
  await expect(page.getByRole("status")).toContainText("Refund RF016");
  await expect(page.getByRole("heading", { name: /Approved but not paid/ })).toHaveCount(0);
  expect(newRefunds()).toEqual([{ id: "RF016", order_id: "O1002", amount_cents: 15000 }]);
});

test("Approval screen: a banner can't claim a payment that didn't happen", async ({ page }) => {
  await page.goto("/approvals?result=paid&refund=RF999");
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.goto("/approvals?result=__proto__");
  await expect(page.getByRole("heading", { name: "Approvals" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(0);
});
