import { expect, test, type Page } from "@playwright/test";

// The village inside the app: scripted invented data, view only.

const scene = (page: Page) => page.getByRole("img", { name: /Pixel-art village/ });

// The engine draws a small canvas label into each scene button once it has mounted,
// so from then on its keys and clicks are listened to.
async function openVillage(page: Page) {
  await page.goto("/village");
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

test("Village: the human desk is a place to read about, not a way out of the village", async ({ page }) => {
  await openVillage(page);
  // Scene 1 never opens the approve/reject window, which would catch the click instead.
  await page.getByRole("button", { name: /^Scene 1/ }).click();
  const box = await scene(page).boundingBox();
  if (!box) throw new Error("the village scene has no size");
  // The desk's hotspot is x 108-180, y 140-200 on the 320 x 240 picture; click its middle.
  await scene(page).click({ position: { x: (144 / 320) * box.width, y: (170 / 240) * box.height } });
  await page.keyboard.press("e");
  await expect(page).toHaveURL(/\/village$/);
});
