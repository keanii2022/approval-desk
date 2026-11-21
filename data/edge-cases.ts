// Edge cases: each rule's exact boundary, one case on each side. A rule that's off by
// one day or one cent shows up here first. Same format as the hole cases; none needs a
// history. Day counts run from the order (or join, or earlier refund) date to the day the
// request arrived, as in docs/RULES.md (Q1 to Q3, Q8).

import type { HoleCase } from "./hole-cases.ts";

const want = (orderId: string, amountCents: number, gate: "allow" | "send_to_human") => ({
  action: "refund" as const,
  orderId,
  amountCents,
  policyLine: "P02",
  gate,
  rules: [],
});

export const edgeCases: HoleCase[] = [
  // R2 (Q1): exactly $100.00 is not over $100. O1004 cost $100.01.
  {
    id: "EDGE-01",
    customerId: "C004",
    receivedOn: "2026-10-02",
    subject: "Dinner set: $100 back",
    body: "Every plate in my stoneware dinner set (O1004) arrived cracked. I'll keep the box, so a refund of exactly $100.00 is fine. Jonah",
    tricky: false,
    history: [],
    expected: want("O1004", 10000, "allow"),
  },
  // R2: one cent over $100 goes to a person.
  {
    id: "EDGE-02",
    customerId: "C004",
    receivedOn: "2026-10-02",
    subject: "Dinner set: full refund",
    body: "Every plate in my stoneware dinner set (O1004) arrived cracked. Please refund the full $100.01. Jonah",
    tricky: false,
    history: [],
    expected: want("O1004", 10001, "send_to_human"),
  },
  // R2: a whole order of exactly $100.00.
  {
    id: "EDGE-03",
    customerId: "C003",
    receivedOn: "2026-10-01",
    subject: "Blanket torn",
    body: "My linen throw blanket (O1003) arrived with a long tear down the middle. Please refund the full $100.00. Priya",
    tricky: false,
    history: [],
    expected: want("O1003", 10000, "allow"),
  },
  // R3 (Q2): exactly 30 days is not older than 30 days. O1001 was placed 2026-09-20.
  {
    id: "EDGE-04",
    customerId: "C001",
    receivedOn: "2026-10-20",
    subject: "Mugs cracked",
    body: "All four mugs in the set from O1001 have cracked in the dishwasher on the gentle cycle. Please refund the $24.00. Mara",
    tricky: false,
    history: [],
    expected: want("O1001", 2400, "allow"),
  },
  // R3: 31 days is, so a person decides.
  {
    id: "EDGE-05",
    customerId: "C001",
    receivedOn: "2026-10-21",
    subject: "Mugs cracked",
    body: "All four mugs in the set from O1001 have cracked in the dishwasher on the gentle cycle. Please refund the $24.00. Mara",
    tricky: false,
    history: [],
    expected: want("O1001", 2400, "send_to_human"),
  },
  // R2 and R3 at their limits together: $100.00 on an order exactly 30 days old.
  {
    id: "EDGE-06",
    customerId: "C004",
    receivedOn: "2026-10-18",
    subject: "Dinner set: $100 back",
    body: "The plates in my stoneware dinner set (O1004) have all cracked. Keeping the bowls, I'd like $100.00 back. Jonah",
    tricky: true,
    history: [],
    expected: want("O1004", 10000, "allow"),
  },
  // R1: exactly what's left after an earlier refund ($60 paid, $25 refunded). R9 then sends it to a person.
  {
    id: "EDGE-07",
    customerId: "C014",
    receivedOn: "2026-10-02",
    subject: "Basket body split",
    body: "You refunded $25 for the cracked lid on my laundry basket (O1026). The basket itself has now split down the side. Please refund the remaining $35.00. Elliot",
    tricky: false,
    history: [],
    expected: want("O1026", 3500, "send_to_human"),
  },
  // R1: a cent more than what's left. The careful answer is what's left, not what's asked.
  {
    id: "EDGE-08",
    customerId: "C014",
    receivedOn: "2026-10-02",
    subject: "Basket body split",
    body: "You refunded $25 for the cracked lid on my laundry basket (O1026). The basket itself has now split down the side. Please refund $35.01. Elliot",
    tricky: true,
    history: [],
    expected: want("O1026", 3500, "send_to_human"),
  },
  // R4 (Q3): Wen's third earlier refund was exactly 90 days before this request, so it counts: 3 refunds.
  {
    id: "EDGE-09",
    customerId: "C010",
    receivedOn: "2026-10-01",
    subject: "Colander chipped",
    body: "My enamel colander (O1019) arrived with a big chip in the enamel. Could I get the $33.00 back? Wen",
    tricky: true,
    history: [],
    expected: want("O1019", 3300, "send_to_human"),
  },
  // R4: one day later it's 91 days old and drops out: 2 refunds, so no person needed.
  {
    id: "EDGE-10",
    customerId: "C010",
    receivedOn: "2026-10-02",
    subject: "Colander chipped",
    body: "My enamel colander (O1019) arrived with a big chip in the enamel. Could I get the $33.00 back? Wen",
    tricky: true,
    history: [],
    expected: want("O1019", 3300, "allow"),
  },
  // R10 (Q8): Juno joined 2026-09-27. Exactly 30 days later the account still counts as new.
  {
    id: "EDGE-11",
    customerId: "C024",
    receivedOn: "2026-10-27",
    subject: "Bowl cracked",
    body: "My ceramic serving bowl (order O1037) cracked straight across the first time I used it. I'd like a refund of $32.00. Juno",
    tricky: false,
    history: [],
    expected: want("O1037", 3200, "send_to_human"),
  },
  // R10: 31 days after joining, the account is no longer new.
  {
    id: "EDGE-12",
    customerId: "C024",
    receivedOn: "2026-10-28",
    subject: "Bowl cracked",
    body: "My ceramic serving bowl (order O1037) cracked straight across the first time I used it. I'd like a refund of $32.00. Juno",
    tricky: false,
    history: [],
    expected: want("O1037", 3200, "allow"),
  },
];
