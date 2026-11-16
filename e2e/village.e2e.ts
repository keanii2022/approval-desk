import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { expect, test, type Page } from "@playwright/test";

// The village is the front page. It plays three made-up stories on its own; the Inbox
// stand opens the try form over it and the human desk lists the visitor's own waiting
// requests. The test server uses the stand-in agent (AGENT_STAND_IN=1, lib/stand-in-agent.ts):
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

// The engine draws a small canvas label into each scene button once it has mounted,
// so from then on its keys and clicks are listened to.
async function openVillage(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Scene 1/ }).locator("canvas")).toBeAttached();
  // Scene 1 never opens the approve/reject window, which would catch a click on the picture instead.
  await page.getByRole("button", { name: /^Scene 1/ }).click();
}

// Clicks a spot given in the 320 x 240 picture's own pixels.
async function clickPicture(page: Page, x: number, y: number) {
  const box = await scene(page).boundingBox();
  if (!box) throw new Error("the village scene has no size");
  await scene(page).click({ position: { x: (x / 320) * box.width, y: (y / 240) * box.height } });
}

test("Village: the front page plays the three scripted stories", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openVillage(page);
  await expect(scene(page)).toBeVisible();
  const frame = () => scene(page).evaluate((c) => (c as HTMLCanvasElement).toDataURL());
  for (const n of [1, 2, 3]) {
    const button = page.getByRole("button", { name: new RegExp(`^Scene ${n}`) });
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    const first = await frame();
    await expect.poll(frame, { timeout: 5000 }).not.toBe(first);
  }
  expect(errors).toEqual([]);
});

test("Village: says what this is, links to GitHub, and says the stories are made up", async ({ page }) => {
  await openVillage(page);
  await expect(page.getByText(/A refund agent for an invented shop/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Code on GitHub" })).toHaveAttribute("href", "https://github.com/keanii2022/approval-desk");
  await expect(page.getByText(/stories playing above are made up/)).toBeVisible();
  await expect(page.getByText(/Your requests are real/)).toBeVisible();
});

test("Village: the old /village address lands on the front page", async ({ page }) => {
  await page.goto("/village");
  await expect(page).toHaveURL(/\/$/);
  await expect(scene(page)).toBeVisible();
});

test("Village: clicking the Inbox stand opens the try form over the village, Escape closes it", async ({ page }) => {
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
  await inbox.getByRole("button", { name: "Honest" }).click();
  // Typing in the form never reaches the village's own keys (1 2 3 would switch the story).
  await inbox.getByLabel("Subject").fill("Lamp 123 broke");
  await expect(page.getByRole("button", { name: /^Scene 1/ })).toHaveAttribute("aria-pressed", "true");
  await inbox.getByRole("button", { name: "Send to the agent" }).click();

  const result = inbox.getByRole("article", { name: /TRY-\d+ result/ });
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(inbox.getByRole("heading", { name: "What happened" })).toBeVisible();
  await expect(result).toContainText("Lamp 123 broke");
  await expect(result).toContainText("The AI was unavailable");
  await expect(result).toContainText("Sent to a person");
  await expect(result).toContainText("Waiting for a person");
  await expect(result.getByRole("link", { name: /Decide it yourself/ })).toHaveAttribute("href", "/approvals");
  await expect(page).toHaveURL(/\/$/);

  // "Send another" brings back an empty form.
  await result.getByRole("button", { name: "Send another" }).click();
  await expect(inbox.getByLabel("Message")).toHaveValue("");
});

test("Village: the human desk lists the visitor's own waiting requests, with a way to the approval screen", async ({ page }) => {
  await openVillage(page);
  // A new visitor has nothing waiting; the seeded practice cases are not theirs.
  await page.keyboard.press("h");
  const desk = panel(page);
  await expect(desk.getByRole("heading", { name: "The human desk" })).toBeVisible();
  await expect(desk).toContainText("Nothing of yours is waiting");
  await expect(desk).not.toContainText("REQ-002");

  // Send one from the Inbox, then come back to the desk by clicking it in the picture.
  await desk.getByRole("button", { name: "Write one at the Inbox" }).click();
  await desk.getByLabel("Write as").selectOption({ label: "Theo Achterberg" });
  await desk.getByRole("button", { name: "Honest" }).click();
  await desk.getByRole("button", { name: "Send to the agent" }).click();
  const result = desk.getByRole("article", { name: /TRY-\d+ result/ });
  await expect(result).toBeVisible({ timeout: 30_000 });
  const requestId = ((await result.getAttribute("aria-label")) ?? "").replace(" result", "");
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();

  // The human desk's hotspot is x 108-180, y 140-200; click its middle.
  await clickPicture(page, 144, 170);
  const list = panel(page).getByRole("list", { name: "Your requests waiting for a person" });
  await expect(list).toContainText(requestId);
  await expect(list).toContainText("Theo Achterberg");
  await panel(page).getByRole("link", { name: /Open the approval screen/ }).click();
  await expect(page).toHaveURL(/\/approvals$/);
  await expect(page.getByRole("article", { name: new RegExp(requestId) })).toBeVisible();
});

// ---- the village plays the visitor's own request (step 20) ----

const village = (page: Page) => page.locator(".village-canvas");
const villageSays = (page: Page) => village(page).locator("[aria-live]");

// ?speed=10 plays the village ten times faster, so a whole request plays in a few seconds.
async function openFastVillage(page: Page) {
  await page.goto("/?speed=10");
  await expect(page.getByRole("button", { name: /^Scene 1/ }).locator("canvas")).toBeAttached();
  await page.getByRole("button", { name: /^Scene 1/ }).click();
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

test("Village: a small refund plays green and the factory pays (R1, R2 pass); the stories pause, then resume", async ({ page }) => {
  await openFastVillage(page);
  const id = await sendAndWatch(page, "Mara Lindqvist", "Two mugs came cracked, a small refund please.", "Refund paid.");
  await expect(village(page)).toHaveAttribute("data-visitor", "playing");
  // The scripted stories step aside: no scene button is pressed while the visitor's request plays.
  for (const n of [1, 2, 3]) await expect(page.getByRole("button", { name: new RegExp(`^Scene ${n}`) })).toHaveAttribute("aria-pressed", "false");
  await expect(villageSays(page)).toContainText(`YOUR REQUEST ${id} ARRIVES`);
  await expect(village(page)).toHaveAttribute("data-gate-light", "green", { timeout: 30_000 });
  await expect(village(page)).toHaveAttribute("data-robot-at", "factory", { timeout: 30_000 });
  await expectInLogbook(page, new RegExp(`${id}, \\$24\\.00, order O1001\\..*Final: REFUND PAID`));
  await expect(page.getByRole("button", { name: /^Scene 1/ })).toHaveAttribute("aria-pressed", "true");
});

test("Village: a big refund plays yellow and waits at the human desk (R2)", async ({ page }) => {
  await openFastVillage(page);
  const id = await sendAndWatch(page, "Theo Achterberg", "My lamp is dead, I want the big refund.", "Waiting for a person");
  await expect(village(page)).toHaveAttribute("data-gate-light", "yellow", { timeout: 30_000 });
  await expect(village(page)).toHaveAttribute("data-robot-at", "desk", { timeout: 30_000 });
  await expect(villageSays(page)).toContainText("YOUR REQUEST WAITS AT THE HUMAN DESK");
  await expectInLogbook(page, new RegExp(`${id}, \\$150\\.00, order O1002\\..*Gate: YELLOW\\. OVER \\$100.*WAITING FOR A PERSON`));
});

test("Village: a garbled answer plays red and nothing is paid (R5)", async ({ page }) => {
  await openFastVillage(page);
  const id = await sendAndWatch(page, "Theo Achterberg", "garbled garbled garbled", "Blocked");
  await expect(village(page)).toHaveAttribute("data-gate-light", "red", { timeout: 30_000 });
  await expectInLogbook(page, new RegExp(`${id}, NO AMOUNT, order NONE\\..*Gate: RED\\. NOT A PROPER FORM.*Final: BLOCKED`));
});
