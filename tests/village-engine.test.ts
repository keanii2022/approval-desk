// The village engine's pure parts: where the robot is (the onStage hook), the keyboard
// guard, and the pixel scale. No DOM, no AI: the picture itself is checked by eye and by
// the browser tests.
import { describe, expect, it } from "vitest";
import { fitScale, getTL, isTypingTarget, stageAt, type VillageStage } from "../app/village/engine.ts";

/** Every distinct stop the robot reaches during a scene, in order, sampled every 50 ms. */
function stops(scene: 1 | 2 | 3, decision: "A" | "R" = "A"): (VillageStage | null)[] {
  const tl = getTL(scene, decision);
  const seen: (VillageStage | null)[] = [];
  for (let t = 0; t <= tl.dur; t += 0.05) {
    const s = stageAt(tl, t);
    if (seen.length === 0 || seen[seen.length - 1] !== s) seen.push(s);
  }
  return seen;
}
const named = (list: (VillageStage | null)[]) => list.filter((s): s is VillageStage => s !== null);

describe("village: the robot's stop, for the onStage hook", () => {
  it("starts at the agent's house and is between stops while walking", () => {
    const tl = getTL(1, "A");
    expect(stageAt(tl, 0)).toBe("agent");
    expect(stageAt(tl, tl.ev.walk1 + 0.1)).toBeNull();
    expect(stageAt(tl, tl.ev.atInbox + 0.1)).toBe("inbox");
    expect(stageAt(tl, tl.ev.arrive + 0.5)).toBe("gate");
    expect(stageAt(tl, tl.ev.atFac + 0.1)).toBe("factory");
    expect(stageAt(tl, tl.dur)).toBe("agent");
  });

  it("scene 1 (small refund): inbox, gate, factory, home", () => {
    const list = stops(1);
    expect(named(list)).toEqual(["agent", "inbox", "gate", "factory", "agent"]);
    expect(list).toContain(null);
  });

  it("scene 2 (big refund): the human desk, then the factory only if approved", () => {
    expect(named(stops(2, "A"))).toEqual(["agent", "inbox", "gate", "desk", "factory", "agent"]);
    expect(named(stops(2, "R"))).toEqual(["agent", "inbox", "gate", "desk", "agent"]);
  });

  it("scene 3 (blocked): the gate sends it straight home, nothing paid", () => {
    expect(named(stops(3))).toEqual(["agent", "inbox", "gate", "agent"]);
  });
});

describe("village: keyboard shortcuts stay out of form fields", () => {
  it("knows inputs, textareas, selects and contenteditable", () => {
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTypingTarget({ tagName: "textarea" })).toBe(true);
    expect(isTypingTarget({ tagName: "SELECT" })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });
  it("lets the rest through", () => {
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingTarget({ tagName: "CANVAS", isContentEditable: false })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
  });
});

describe("village: pixel scale from the container width", () => {
  it("fits 1x, 2x or 3x and never more", () => {
    expect(fitScale(0)).toBe(1);
    expect(fitScale(340)).toBe(1);
    expect(fitScale(668)).toBe(2);
    expect(fitScale(700)).toBe(2); // the prototype's floor: a wide screen never drops below 2x
    expect(fitScale(1000)).toBe(2);
    expect(fitScale(1002)).toBe(3);
    expect(fitScale(4000)).toBe(3);
  });
  it("counts the device's bezel unless the page asked for a bare screen", () => {
    expect(fitScale(960)).toBe(2);
    expect(fitScale(960, 0)).toBe(3);
  });
});
