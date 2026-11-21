import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { countsPath, visitorFolder } from "../lib/visitor-db.ts";

// The owner's dashboard, on the test shop (prepare-queue: the seeded shop plus the three
// overnight requests waiting for a person). Read only; no AI calls.

const DB = "data/e2e.db";

test.beforeEach(() => {
  execFileSync("node", ["scripts/prepare-queue.ts", DB], { stdio: "pipe" });
  rmSync(visitorFolder(DB), { recursive: true, force: true });
  rmSync(countsPath(DB), { force: true });
});

test("Dashboard: every section loads from the real data", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "The dashboard" })).toBeVisible();

  await expect(page.getByRole("list", { name: "Shop totals" })).toContainText("24 customers");
  await expect(page.getByRole("table", { name: "Customers" })).toContainText("Max Quill");
  await expect(page.getByRole("table", { name: "Customers" })).toContainText("Flagged");
  const orders = page.getByRole("table", { name: "Orders" });
  await expect(orders.getByRole("row", { name: /O1038/ })).toContainText("In transit");

  await expect(page.getByRole("table", { name: "Inbox" }).getByRole("row", { name: /REQ-002/ })).toContainText("Waiting for a person");

  await expect(page.getByRole("heading", { name: "Human desk (3)" })).toBeVisible();
  await expect(page.getByRole("article", { name: /REQ-002/ })).toBeVisible();

  await expect(page.getByRole("table", { name: "Logbook" }).getByRole("row", { name: /REQ-018/ })).toContainText("the AI gave no answer");

  // The latest scorecard, with its date.
  await expect(page.locator(".dash-latest")).toContainText(/Latest scorecard: \d{4}-\d{2}-\d{2},/);
  await expect(page.getByRole("table", { name: "Scorecards" }).getByRole("row")).not.toHaveCount(1);

  // Step 31: the desk load table, or its empty line until a scorecard keeps every answer.
  const desk = "Sent to a person, per 100 requests";
  await expect(page.getByRole("heading", { name: desk })).toBeVisible();
  await expect(page.getByRole("table", { name: desk }).or(page.getByText("Shows after the next eval run."))).toBeVisible();
});

test("Dashboard: the section bar jumps to each section", async ({ page }) => {
  await page.goto("/dashboard");
  for (const [link, heading] of [
    ["Shop", "Shop"],
    ["Inbox", /^Inbox/],
    ["Human desk (3)", "Human desk (3)"],
    ["Logbook", "Logbook"],
    ["Evals", "Evals"],
  ] as const) {
    await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: link }).click();
    await expect(page.getByRole("heading", { name: heading, level: 2 })).toBeInViewport();
  }
});

test("Dashboard: opened from the shop house in the village, and from the link at the top", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /palette/ }).locator("canvas")).toBeAttached();
  const scene = page.getByRole("img", { name: /Pixel-art village/ });
  const box = await scene.boundingBox();
  if (!box) throw new Error("the village scene has no size");
  // The shop's hotspot is x 106-198, y 38-120 in the 320 x 240 picture; click its middle.
  await scene.click({ position: { x: (152 / 320) * box.width, y: (79 / 240) * box.height } });
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/");
  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});
