import { describe, expect, it } from "vitest";
import { dollars, parseDollars } from "../lib/money.ts";

describe("money: cents to dollars", () => {
  it("shows whole cents as dollars", () => {
    expect(dollars(2400)).toBe("$24.00");
    expect(dollars(5)).toBe("$0.05");
    expect(dollars(10001)).toBe("$100.01");
    expect(dollars(1234567)).toBe("$12,345.67");
    expect(dollars(0)).toBe("$0.00");
  });
});

describe("money: what a person types, to cents", () => {
  it("reads plain dollar amounts", () => {
    expect(parseDollars("150")).toBe(15000);
    expect(parseDollars("150.00")).toBe(15000);
    expect(parseDollars("24.5")).toBe(2450);
    expect(parseDollars(" $1,200.05 ")).toBe(120005);
    expect(parseDollars("0.01")).toBe(1);
    expect(parseDollars("1,000")).toBe(100000);
    expect(parseDollars("12,345,678.9")).toBe(1234567890);
  });

  it("refuses anything that isn't a clear, positive amount, and never rounds", () => {
    for (const bad of ["", "  ", "0", "0.00", "-5", "12.345", "abc", "12abc", "1e3", "$", ".5", "5.", "1,2,3x", "1,50", "12,34", "1,2,3", "1,2345", ",500", "1,000,", "NaN", "Infinity", "9".repeat(20)]) {
      expect(parseDollars(bad), `"${bad}"`).toBeNull();
    }
  });
});
