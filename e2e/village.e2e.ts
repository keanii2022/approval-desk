import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { expect, test, type Page } from "@playwright/test";

// The village is the front page. The robot waits until something is sent. The Inbox opens a
// panel with three made-up stories (no AI) and the try form (the agent); the human desk is the
// approval screen. The test server uses the stand-in agent (AGENT_STAND_IN=1, lib/stand-in-agent.ts):
// a message with "small", "big" or "garbled" gets a fixed form, anything else gets no answer,
// as if the AI were down (R6). Deterministic and free; the real AI is never called.

const DB = "data/e2e.db";

test.beforeEach(() => {
  execFileSync("node", ["scripts/prepare-queue.ts", DB], { stdio: "pipe" });
  // prepare-queue rebuilds the Inbox but not the table of who sent which try, so the next
  // TRY-001 would collide with the last test's. Clear it too.
  const db = new DatabaseSync(DB);
  try {
    db.exec("DELETE FROM try_owners");
  } catch {
    // no try was ever made on this file, so the table doesn't exist yet
  } finally {
    db.close();
  }
});

const scene = (page: Page) => page.getByRole("img", { name: /Pixel-art village/ });
const panel = (page: Page) => page.getByRole("dialog");

// The engine draws a small canvas label into each of its buttons once it has mounted,
// so from then on its keys and clicks are listened to.
async function openVillage(page: Page, path = "/") {
  await page.goto(path);
  await expect(page.getByRole("button", { name: /palette/ }).locator("canvas")).toBeAttached();
}

// Clicks a spot given in the 320 x 240 picture's own pixels.
async function clickPicture(page: Page, x: number, y: number) {
  const box = await scene(page).boundingBox();
  if (!box) throw new Error("the village scene has no size");
  await scene(page).click({ position: { x: (x / 320) * box.width, y: (y / 240) * box.height } });
}

test("Village: no scene buttons; a made-up story under the village plays without the AI, then the robot waits", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openVillage(page, "/?speed=10");
  await expect(scene(page)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Scene|Play a demo|Auto-play/ })).toHaveCount(0);
  await expect(page.getByRole("slider", { name: "Playback speed" })).toHaveValue("1");
  await expect(villageSays(page)).toContainText("THE INBOX TO SEND A REQUEST");
  const frame = () => scene(page).evaluate((c) => (c as HTMLCanvasElement).toDataURL());
  await page.getByRole("button", { name: /Small refund/ }).click();
  // At ten times the speed its first line flashes by, so check that it left the resting line.
  await expect(villageSays(page)).not.toContainText("THE INBOX TO SEND");
  const first = await frame();
  await expect.poll(frame, { timeout: 5000 }).not.toBe(first);
  await expect(villageSays(page)).toContainText("THE INBOX TO SEND A REQUEST", { timeout: 60_000 });
  expect(errors).toEqual([]);
});

// The browser tests raise the limits to 100 (playwright.config.ts), so the count starts there.
test("Village: says what this is, links to GitHub, and has two ways in: the Inbox and the human desk", async ({ page }) => {
  await openVillage(page);
  await expect(page.getByText(/A Claude refund agent for an invented shop/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Code on GitHub" })).toHaveAttribute("href", "https://github.com/keanii2022/approval-desk");
  await expect(page.getByRole("link", { name: /Human desk/ })).toHaveAttribute("href", "/approvals");
  await expect(page.getByRole("heading", { name: "Watch a story" })).toBeVisible();
  await page.getByRole("button", { name: /The Inbox/ }).click();
  const inbox = panel(page);
  await expect(inbox.getByRole("heading", { name: "Try it yourself" })).toBeVisible();
  await expect(inbox.getByText("100 tries left this hour.")).toBeVisible();
  // Ideas only: nothing fills in the message for the visitor.
  await inbox.getByText("Ideas to try to break it").click();
  await expect(inbox.getByText("Ask for more money than the order cost.")).toBeVisible();
  await expect(inbox.getByRole("button", { name: "Honest" })).toHaveCount(0);
});

test("Village: the old /try page lands on the front page", async ({ page }) => {
  await page.goto("/try");
  await expect(page).toHaveURL(/\/$/);
  await expect(scene(page)).toBeVisible();
});

test("Village: the old /village address lands on the front page", async ({ page }) => {
  await page.goto("/village");
  await expect(page).toHaveURL(/\/$/);
  await expect(scene(page)).toBeVisible();
});

test("Village: clicking the Inbox stand opens it over the village, Escape closes it", async ({ page }) => {
  await openVillage(page);
  // The Inbox stand's hotspot is x 28-90, y 44-86; click its middle.
  await clickPicture(page, 59, 65);
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole("heading", { name: "The Inbox" })).toBeVisible();
  await expect(panel(page).getByLabel("Write as")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  await expect(page).toHaveURL(/\/$/);
});

test("Village: key I opens the Inbox; a sent request shows its result in the panel (R6: AI unavailable goes to a person)", async ({ page }) => {
  await openVillage(page);
  await page.keyboard.press("i");
  const inbox = panel(page);
  await expect(inbox).toBeVisible();
  await inbox.getByLabel("Write as").selectOption({ label: "Theo Achterberg" });
  await expect(inbox.getByRole("table", { name: "Theo Achterberg's orders" })).toBeVisible();
  await inbox.getByLabel("Message").fill("My walnut desk lamp from O1002 broke. Please refund it.");
  // Typing in the form never reaches the village's own keys (L would open the logbook).
  await inbox.getByLabel("Subject").press("L");
  await inbox.getByLabel("Subject").fill("Lamp 123 broke");
  await expect(villageSays(page)).not.toContainText("Logbook");
  await inbox.getByRole("button", { name: "Send to the agent" }).click();

  const result = inbox.getByRole("article", { name: /TRY-\d+ result/ });
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(inbox.getByRole("heading", { name: "What happened" })).toBeVisible();
  await expect(result).toContainText("Lamp 123 broke");
  await expect(result).toContainText("The AI didn't answer");
  await expect(result).toContainText("Sent to a person");
  await expect(result).toContainText("Waiting for a person");
  await expect(result.getByRole("link", { name: /Decide it yourself/ })).toHaveAttribute("href", "/approvals");
  await expect(page).toHaveURL(/\/$/);

  // "Send another" brings back an empty form.
  await result.getByRole("button", { name: "Send another" }).click();
  await expect(inbox.getByLabel("Message")).toHaveValue("");
  await expect(inbox.getByText("99 tries left this hour.")).toBeVisible();
});

test("Village: the human desk is the approval screen; key H and the desk in the picture open it", async ({ page }) => {
  await openVillage(page);
  await page.keyboard.press("h");
  await expect(page).toHaveURL(/\/approvals$/);

  // Send one from the Inbox, then open the desk by clicking it in the picture.
  await openVillage(page);
  await page.keyboard.press("i");
  const inbox = panel(page);
  await inbox.getByLabel("Write as").selectOption({ label: "Theo Achterberg" });
  await inbox.getByLabel("Message").fill("My walnut desk lamp from O1002 broke. Please refund it.");
  await inbox.getByRole("button", { name: "Send to the agent" }).click();
  const result = inbox.getByRole("article", { name: /TRY-\d+ result/ });
  await expect(result).toBeVisible({ timeout: 30_000 });
  const requestId = ((await result.getAttribute("aria-label")) ?? "").replace(" result", "");
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();

  // The human desk's hotspot is x 108-180, y 140-200; click its middle.
  await clickPicture(page, 144, 170);
  await expect(page).toHaveURL(/\/approvals$/);
  await expect(page.getByRole("article", { name: new RegExp(requestId) })).toBeVisible();
});

// ---- the village plays the visitor's own request (step 20) ----

const village = (page: Page) => page.locator(".village-canvas");
const villageSays = (page: Page) => village(page).locator("[aria-live]");

// ?speed=10 plays the village ten times faster, so a whole request plays in a few seconds.
async function openFastVillage(page: Page) {
  await openVillage(page, "/?speed=10");
}

// Sends one request from the Inbox panel, checks the panel's result, then closes it to watch.
async function sendAndWatch(page: Page, customer: string, message: string, outcome: string): Promise<string> {
  await page.keyboard.press("i");
  const inbox = panel(page);
  await inbox.getByLabel("Write as").selectOption({ label: customer });
  await inbox.getByLabel("Subject").fill("Village test");
  await inbox.getByLabel("Message").fill(message);
  await inbox.getByRole("button", { name: "Send to the agent" }).click();
  const result = inbox.getByRole("article", { name: /TRY-\d+ result/ });
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(result).toContainText(outcome);
  const requestId = ((await result.getAttribute("aria-label")) ?? "").replace(" result", "");
  await result.getByRole("button", { name: "Watch it in the village" }).click();
  await expect(panel(page)).toBeHidden();
  return requestId;
}

// Waits for the play to end, then opens the logbook window (key L) and reads it.
async function expectInLogbook(page: Page, text: RegExp) {
  await expect(village(page)).toHaveAttribute("data-visitor", "idle", { timeout: 60_000 });
  await page.keyboard.press("l");
  await expect(villageSays(page)).toContainText(text);
  await page.keyboard.press("Escape");
}

test("Village: a small refund plays green and the factory pays (R1, R2 pass); then the robot waits again", async ({ page }) => {
  await openFastVillage(page);
  const id = await sendAndWatch(page, "Mara Lindqvist", "Two mugs came cracked, a small refund please.", "Refund paid.");
  await expect(village(page)).toHaveAttribute("data-visitor", "playing");
  await expect(villageSays(page)).toContainText(`YOUR REQUEST ${id} ARRIVES`);
  await expect(village(page)).toHaveAttribute("data-gate-light", "green", { timeout: 30_000 });
  await expect(village(page)).toHaveAttribute("data-robot-at", "factory", { timeout: 30_000 });
  await expectInLogbook(page, new RegExp(`${id}, \\$24\\.00, order O1001\\..*Final: REFUND PAID`));
  await expect(villageSays(page)).toContainText("THE INBOX TO SEND A REQUEST");
});

// The visitor's own request that needs a person: the robot holds at the desk until they decide.
async function holdAtDesk(page: Page): Promise<string> {
  await openFastVillage(page);
  const id = await sendAndWatch(page, "Theo Achterberg", "My lamp is dead, I want the big refund.", "Waiting for a person");
  await expect(village(page)).toHaveAttribute("data-gate-light", "yellow", { timeout: 30_000 });
  await expect(village(page)).toHaveAttribute("data-robot-at", "desk", { timeout: 30_000 });
  await expect(villageSays(page)).toContainText("YOUR REQUEST NEEDS A PERSON");
  return id;
}

test("Village: your own big refund waits for you at the desk; you approve it there and the factory pays (R2)", async ({ page }) => {
  const id = await holdAtDesk(page);
  await page.getByRole("button", { name: "Approve the refund" }).click();
  const decide = panel(page);
  await expect(decide.getByRole("heading", { name: "Your call" })).toBeVisible();
  await decide.getByRole("button", { name: "Approve and pay" }).click();
  await expect(panel(page)).toBeHidden();
  await expect(village(page)).toHaveAttribute("data-robot-at", "factory", { timeout: 30_000 });
  await expectInLogbook(page, new RegExp(`${id}, \\$150\\.00, order O1002\\..*APPROVED BY YOU`));
  await page.goto("/approvals");
  await expect(page.getByRole("article", { name: new RegExp(id) })).toHaveCount(0);
});

test("Village: rejecting your own big refund at the desk needs a note, then nothing is paid (R2)", async ({ page }) => {
  const id = await holdAtDesk(page);
  // Tapping the desk in the picture opens the same decision.
  await clickPicture(page, 144, 170);
  const decide = panel(page);
  await decide.getByRole("button", { name: "Reject" }).click();
  await expect(decide.getByRole("alert")).toBeVisible();
  await decide.getByLabel(/Why are you rejecting/).fill("Bought too long ago");
  await decide.getByRole("button", { name: "Reject" }).click();
  await expect(panel(page)).toBeHidden();
  await expectInLogbook(page, new RegExp(`${id}, .*REJECTED BY YOU`));
});

test("Village: a garbled answer plays red and nothing is paid (R5)", async ({ page }) => {
  await openFastVillage(page);
  const id = await sendAndWatch(page, "Theo Achterberg", "garbled garbled garbled", "Blocked");
  await expect(village(page)).toHaveAttribute("data-gate-light", "red", { timeout: 30_000 });
  await expectInLogbook(page, new RegExp(`${id}, NO AMOUNT, order NONE\\..*Gate: RED\\. NOT A PROPER FORM.*Final: BLOCKED`));
});
