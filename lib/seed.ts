import type { DatabaseSync } from "node:sqlite";
import { inbox } from "../data/inbox.ts";
import { policyLines } from "../data/policy.ts";
import { customers, orders, refunds } from "../data/shop.ts";

export const SEEDED_TABLES = ["customers", "orders", "refunds", "policy_lines", "inbox"] as const;

const SCHEMA = `
  DROP TABLE IF EXISTS inbox;
  DROP TABLE IF EXISTS refunds;
  DROP TABLE IF EXISTS orders;
  DROP TABLE IF EXISTS customers;
  DROP TABLE IF EXISTS policy_lines;

  CREATE TABLE customers (
    id    TEXT PRIMARY KEY,
    name  TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE
  );

  CREATE TABLE orders (
    id                TEXT PRIMARY KEY,
    customer_id       TEXT NOT NULL REFERENCES customers(id),
    placed_on         TEXT NOT NULL,
    item              TEXT NOT NULL,
    amount_paid_cents INTEGER NOT NULL CHECK (amount_paid_cents > 0)
  );

  CREATE TABLE refunds (
    id           TEXT PRIMARY KEY,
    order_id     TEXT NOT NULL REFERENCES orders(id),
    refunded_on  TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    reason       TEXT NOT NULL
  );

  CREATE TABLE policy_lines (
    id      TEXT PRIMARY KEY,
    section TEXT NOT NULL,
    rule_id TEXT,
    text    TEXT NOT NULL
  );

  CREATE TABLE inbox (
    id          TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    received_on TEXT NOT NULL,
    subject     TEXT NOT NULL,
    body        TEXT NOT NULL
  );
`;

// Wipes the shop data, policy, and Inbox tables and loads them again from the
// files in data/. Only fixed values are used, so every run gives identical data.
export function seed(db: DatabaseSync): void {
  db.exec("BEGIN");
  try {
    db.exec(SCHEMA);

    const insertCustomer = db.prepare("INSERT INTO customers (id, name, email) VALUES (?, ?, ?)");
    for (const c of customers) insertCustomer.run(c.id, c.name, c.email);

    const insertOrder = db.prepare(
      "INSERT INTO orders (id, customer_id, placed_on, item, amount_paid_cents) VALUES (?, ?, ?, ?, ?)",
    );
    for (const o of orders) insertOrder.run(o.id, o.customerId, o.placedOn, o.item, o.amountPaidCents);

    const insertRefund = db.prepare(
      "INSERT INTO refunds (id, order_id, refunded_on, amount_cents, reason) VALUES (?, ?, ?, ?, ?)",
    );
    for (const r of refunds) insertRefund.run(r.id, r.orderId, r.refundedOn, r.amountCents, r.reason);

    const insertPolicyLine = db.prepare("INSERT INTO policy_lines (id, section, rule_id, text) VALUES (?, ?, ?, ?)");
    for (const p of policyLines) insertPolicyLine.run(p.id, p.section, p.ruleId, p.text);

    const insertRequest = db.prepare(
      "INSERT INTO inbox (id, customer_id, received_on, subject, body) VALUES (?, ?, ?, ?, ?)",
    );
    for (const q of inbox) insertRequest.run(q.id, q.customerId, q.receivedOn, q.subject, q.body);

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
