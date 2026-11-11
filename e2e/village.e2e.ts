import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

// The village inside the app, and the switch between it and the robot-eye Human Desk.
// The desk page reads the same queue as the approval tests, so it is rebuilt each time.
const DB = "data/e2e.db";

test.beforeEach(() => {
  execFileSync("node", ["scripts/prepare-queue.ts", DB], { stdio: "pipe" });
});

const scene = (page: Page) => page.getByRole("img", { name: /Pixel-art village/ });

// The engine draws a small canvas label into each scene button once it has mounted,
// so from then on its keys and clicks are listened to.
async function openVillage(page: Page) {
  await page.goto("/village");
  await expect(page.getByRole("button", { name: /^Scene 1/ }).locator("canvas")).toBeAttached();
}

// The approve buttons switch on once the page is ready in the browser, and so do its keys.
async function expectDesk(page: Page) {
  await expect(page).toHaveURL(/\/approvals$/);
  await expect(page.getByRole("button", { name: "Approve and pay" }).first()).toBeEnabled();
}

async function expectVillage(page: Page) {
  await expect(page).toHaveURL(/\/village$/);
  await expect(page.getByRole("button", { name: /^Scene 1/ }).locator("canvas")).toBeAttached();
}

test("Village: the prototype plays inside the app at /village", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openVillage(page);
  await expect(page).toHaveTitle("Village | Approval Desk");
  await expect(scene(page)).toBeVisible();
  const frame = () => scene(page).evaluate((c) => (c as HTMLCanvasElement).toDataURL());
  const first = await frame();
  await expect.poll(frame, { timeout: 5000 }).not.toBe(first);
  expect(errors).toEqual([]);
});

test("Switch by click: the human desk in the village opens the robot-eye view, and Back to village returns", async ({ page }) => {
  await openVillage(page);
  // Scene 1 never opens the approve/reject window, which would catch the click instead.
  await page.getByRole("button", { name: /^Scene 1/ }).click();
  const box = await scene(page).boundingBox();
  if (!box) throw new Error("the village scene has no size");
  // The desk's hotspot is x 108-180, y 140-200 on the 320 x 240 picture; click its middle.
  await scene(page).click({ position: { x: (144 / 320) * box.width, y: (170 / 240) * box.height } });
  await expectDesk(page);

  // The dialogue bar's Back to village (the header has the same link, earlier on the page).
  await page.getByRole("link", { name: /Back to village/ }).last().click();
  await expectVillage(page);
});

test("Switch by keyboard: E in the village opens the robot-eye view, and B returns", async ({ page }) => {
  await openVillage(page);
  await page.keyboard.press("e");
  await expectDesk(page);

  await page.keyboard.press("b");
  await expectVillage(page);
});

test("Switch by keyboard: typing a B into a note on the desk does not leave the page", async ({ page }) => {
  await page.goto("/approvals");
  await expectDesk(page);
  const note = page.getByLabel(/Why are you rejecting it/).first();
  await note.press("b");
  await expect(note).toHaveValue("b");
  await expect(page).toHaveURL(/\/approvals$/);
});
