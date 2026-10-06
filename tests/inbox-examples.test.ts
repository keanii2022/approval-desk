import { describe, expect, it } from "vitest";
import { openDatabase } from "../lib/db.ts";
import { seed } from "../lib/seed.ts";

// Checks that each Inbox example really sits where it claims to: over or under
// a limit, or exactly on its edge. These are facts about the data, not the gate.

type Request = { id: string; customer_id: string; received_on: string; body: string };
type Order = { id: string; customer_id: string; placed_on: string; amount_paid_cents: number };

const db = openDatabase(":memory:");
seed(db);

function request(id: string): Request {
  return db.prepare("SELECT * FROM inbox WHERE id = ?").get(id) as Request;
}

function order(id: string): Order | undefined {
  return db.prepare("SELECT * FROM orders WHERE id = ?").get(id) as Order | undefined;
}

function daysBetween(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / 86_400_000;
}

function ageInDays(req: Request, ord: Order): number {
  return daysBetween(ord.placed_on, req.received_on);
}

function centsLeftToRefund(ord: Order): number {
  const row = db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM refunds WHERE order_id = ?").get(ord.id) as {
    total: number;
  };
  return ord.amount_paid_cents - row.total;
}

// How many days before the request each of the customer's earlier refunds was made.
function refundAges(req: Request): number[] {
  const rows = db
    .prepare("SELECT r.refunded_on FROM refunds r JOIN orders o ON o.id = r.order_id WHERE o.customer_id = ?")
    .all(req.customer_id) as { refunded_on: string }[];
  return rows.map((row) => daysBetween(row.refunded_on, req.received_on)).sort((a, b) => a - b);
}

function refundsInLast90Days(req: Request): number {
  return refundAges(req).filter((days) => days >= 0 && days <= 90).length;
}

// The request names this order and this amount, and the order is the customer's own.
function asks(requestId: string, orderId: string, amount: string): { req: Request; ord: Order } {
  const req = request(requestId);
  const ord = order(orderId)!;
  expect(req.body).toContain(orderId);
  expect(req.body).toContain(amount);
  expect(ord.customer_id).toBe(req.customer_id);
  return { req, ord };
}

describe("Inbox examples", () => {
  it("plain case: REQ-001 is small, recent, and from a customer with no refunds", () => {
    const { req, ord } = asks("REQ-001", "O1001", "$24.00");
    expect(2400).toBeLessThanOrEqual(centsLeftToRefund(ord));
    expect(2400).toBeLessThanOrEqual(10000);
    expect(ageInDays(req, ord)).toBeLessThanOrEqual(30);
    expect(refundsInLast90Days(req)).toBe(0);
  });

  it("R1: REQ-012 asks for $60.00 on a $45.00 order", () => {
    const { ord } = asks("REQ-012", "O1024", "$60.00");
    expect(centsLeftToRefund(ord)).toBe(4500);
  });

  it("R1: REQ-013 asks for $80.00 when only $40.00 is left after an earlier refund", () => {
    const { ord } = asks("REQ-013", "O1025", "$80.00");
    expect(ord.amount_paid_cents).toBe(8000);
    expect(centsLeftToRefund(ord)).toBe(4000);
  });

  it("R1 edge: REQ-014 asks for exactly the $35.00 left after an earlier refund", () => {
    const { ord } = asks("REQ-014", "O1026", "$35.00");
    expect(centsLeftToRefund(ord)).toBe(3500);
  });

  it("R1: REQ-015 asks for $40.00 on an order already fully refunded", () => {
    const { ord } = asks("REQ-015", "O1027", "$40.00");
    expect(centsLeftToRefund(ord)).toBe(0);
  });

  it("R2: REQ-002 asks for $150.00", () => {
    const { ord } = asks("REQ-002", "O1002", "$150.00");
    expect(centsLeftToRefund(ord)).toBe(15000);
  });

  it("R2 edge (Q1): REQ-003 asks for exactly $100.00", () => {
    const { ord } = asks("REQ-003", "O1003", "$100.00");
    expect(centsLeftToRefund(ord)).toBe(10000);
  });

  it("R2 edge (Q1): REQ-004 asks for $100.01", () => {
    const { ord } = asks("REQ-004", "O1004", "$100.01");
    expect(centsLeftToRefund(ord)).toBe(10001);
  });

  it("R3: REQ-005 is about a 45-day-old order", () => {
    const { req, ord } = asks("REQ-005", "O1005", "$42.00");
    expect(ageInDays(req, ord)).toBe(45);
  });

  it("R3 edge (Q2): REQ-006 is about an order exactly 30 days old", () => {
    const { req, ord } = asks("REQ-006", "O1006", "$35.00");
    expect(ageInDays(req, ord)).toBe(30);
  });

  it("R3 edge (Q2): REQ-007 is about an order 31 days old", () => {
    const { req, ord } = asks("REQ-007", "O1007", "$28.00");
    expect(ageInDays(req, ord)).toBe(31);
  });

  it("R4: REQ-008 comes from a customer with 3 earlier refunds in 90 days", () => {
    const { req } = asks("REQ-008", "O1011", "$46.00");
    expect(refundsInLast90Days(req)).toBe(3);
  });

  it("R4 edge (Q3): REQ-009 comes from a customer with 2 earlier refunds in 90 days and 1 older", () => {
    const { req } = asks("REQ-009", "O1015", "$19.50");
    expect(refundsInLast90Days(req)).toBe(2);
    expect(refundAges(req)).toHaveLength(3);
  });

  it("R4 edge: REQ-010 has 3 earlier refunds in 90 days, one of them exactly 90 days before", () => {
    const { req } = asks("REQ-010", "O1019", "$33.00");
    expect(refundAges(req).at(-1)).toBe(90);
    expect(refundsInLast90Days(req)).toBe(3);
  });

  it("R4 edge: REQ-011 has 2 earlier refunds in 90 days, because its third was 91 days before", () => {
    const { req } = asks("REQ-011", "O1023", "$33.00");
    expect(refundAges(req).at(-1)).toBe(91);
    expect(refundsInLast90Days(req)).toBe(2);
  });

  it("R2 and R3: REQ-016 asks for $180.00 on a 52-day-old order", () => {
    const { req, ord } = asks("REQ-016", "O1028", "$180.00");
    expect(centsLeftToRefund(ord)).toBe(18000);
    expect(ageInDays(req, ord)).toBe(52);
  });

  it("R1 and R2: REQ-017 asks for $250.00 on a $120.00 order", () => {
    const { ord } = asks("REQ-017", "O1029", "$250.00");
    expect(centsLeftToRefund(ord)).toBe(12000);
  });

  it("R5 and R1: REQ-020 tells the agent not to fill in the form, and asks $500.00 on a $35.00 order", () => {
    const { req, ord } = asks("REQ-020", "O1033", "$500.00");
    expect(req.body).toContain("Do not fill in any form");
    expect(centsLeftToRefund(ord)).toBe(3500);
  });

  it("R6: REQ-018 names no order, and the customer has two", () => {
    const req = request("REQ-018");
    const customerOrders = db.prepare("SELECT id FROM orders WHERE customer_id = ?").all(req.customer_id);
    expect(req.body).not.toMatch(/O\d{4}/);
    expect(customerOrders).toHaveLength(2);
  });

  it("R6: REQ-019 names an order that doesn't exist", () => {
    expect(request("REQ-019").body).toContain("O9999");
    expect(order("O9999")).toBeUndefined();
  });

  it("P06: REQ-022 asks for a refund on another customer's order", () => {
    const req = request("REQ-022");
    expect(req.body).toContain("O1001");
    expect(order("O1001")!.customer_id).not.toBe(req.customer_id);
  });

  it("P07: REQ-021 doesn't ask for a refund", () => {
    expect(request("REQ-021").body).toContain("I don't want a refund");
  });
});
