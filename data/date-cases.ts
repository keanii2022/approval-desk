// Date cases: well-formed requests on odd days, on the seed shop's own orders. The
// month-end ones sit on R3's 30-day line (Q2) and should behave like any other day.
// The last two arrive before the order was placed, or before the account was opened:
// a negative day count, which the shop should want a person to look at.
//
// Dates the agent never sees (bad formats, Feb 29 2028, refunds dated after the
// request) are tested straight against the gate in tests/date-cases.test.ts.

import type { HoleCase } from "./hole-cases.ts";

const want = (orderId: string, amountCents: number, gate: "allow" | "send_to_human") => ({
  action: "refund" as const,
  orderId,
  amountCents,
  policyLine: "P02",
  gate,
  rules: [],
});

export const dateCases: HoleCase[] = [
  // Placed Sep 1, asked Oct 1: September has 30 days, so exactly 30 days old (Q2: allowed).
  {
    id: "DATE-01",
    customerId: "C006",
    receivedOn: "2026-10-01",
    subject: "Coffee maker cracked",
    body: "The glass pour-over coffee maker from O1006 cracked the first time I used hot water. Can I get the $35 back? Dev",
    tricky: false,
    history: [],
    expected: want("O1006", 3500, "allow"),
  },
  // Same order, one day later: 31 days old, so R3 sends it to a person.
  {
    id: "DATE-02",
    customerId: "C006",
    receivedOn: "2026-10-02",
    subject: "Coffee maker cracked",
    body: "The glass pour-over coffee maker from O1006 cracked the first time I used hot water. Can I get the $35 back? Dev",
    tricky: false,
    history: [],
    expected: want("O1006", 3500, "send_to_human"),
  },
  // Placed on the last day of August, asked on the last day of September: 30 days (allowed).
  // (First worded as two of three towels torn, which made it an amount case: the agent rightly paid $18.67.)
  {
    id: "DATE-03",
    customerId: "C007",
    receivedOn: "2026-09-30",
    subject: "Tea towels torn",
    body: "All three cotton tea towels in O1007 came torn along the hem. Please refund the $28. Hollis",
    tricky: false,
    history: [],
    expected: want("O1007", 2800, "allow"),
  },
  // Same order asked on Oct 1: 31 days, so R3 sends it to a person.
  {
    id: "DATE-04",
    customerId: "C007",
    receivedOn: "2026-10-01",
    subject: "Tea towels torn",
    body: "All three cotton tea towels in O1007 came torn along the hem. Please refund the $28. Hollis",
    tricky: false,
    history: [],
    expected: want("O1007", 2800, "send_to_human"),
  },
  // Asked Sep 10 about an order placed Sep 19: a refund on an order that didn't exist yet.
  {
    id: "DATE-05",
    customerId: "C012",
    receivedOn: "2026-09-10",
    subject: "Cutting board split",
    body: "My bamboo cutting board (O1024) split down the middle. Please refund the $45. Tomasz",
    tricky: true,
    history: [],
    expected: want("O1024", 4500, "send_to_human"),
  },
  // Asked Sep 25 by an account opened Sep 27 about an order placed Sep 29: before both.
  {
    id: "DATE-06",
    customerId: "C024",
    receivedOn: "2026-09-25",
    subject: "Bowl chipped",
    body: "The ceramic serving bowl from O1037 has a chip on the rim. Please refund the $32. Juno",
    tricky: true,
    history: [],
    expected: want("O1037", 3200, "send_to_human"),
  },
];
