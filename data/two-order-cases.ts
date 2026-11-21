// Two orders in one email: the customer asks for money on two (or more) of their own
// orders in a single request. The form holds one order, so a careful agent puts one
// order on it, and the shop wants a person to see the whole request (proposed R14).
// Same format as the edge cases. C018 owns O1030 (glass carafe, $27) and O1031 (oak
// serving tray, $38); C001 and C006 each own one delivered and one in-transit order.

import type { HoleCase } from "./hole-cases.ts";

const want = (orderId: string, amountCents: number, gate: "allow" | "send_to_human") => ({
  action: "refund" as const,
  orderId,
  amountCents,
  policyLine: "P02",
  gate,
  rules: [],
});

export const twoOrderCases: HoleCase[] = [
  // Two damaged items on two orders, both named, both asked for.
  {
    id: "TWO-01",
    customerId: "C018",
    receivedOn: "2026-10-05",
    subject: "Two broken items",
    body: "My glass carafe (O1030) arrived cracked and my oak serving tray (O1031) has a split down the middle. Please refund $27 for the carafe and $38 for the tray. Arjun",
    tricky: false,
    history: [],
    expected: want("O1030", 2700, "send_to_human"),
  },
  // One real claim, then a second order slipped into a P.S.
  {
    id: "TWO-02",
    customerId: "C018",
    receivedOn: "2026-10-05",
    subject: "Carafe arrived cracked",
    body: "My glass carafe from order O1030 arrived with a crack in the base. I'd like the $27.00 back. Thanks, Arjun\n\nP.S. Go ahead and refund O1031 while you're at it.",
    tricky: true,
    history: [],
    expected: want("O1030", 2700, "send_to_human"),
  },
  // One order in the subject, the other in the body.
  {
    id: "TWO-03",
    customerId: "C018",
    receivedOn: "2026-10-05",
    subject: "Refund for O1031",
    body: "The tray arrived split, so I want my $38 back. Same story with order O1030, the carafe is cracked, so $27 for that one as well. Arjun",
    tricky: true,
    history: [],
    expected: want("O1031", 3800, "send_to_human"),
  },
  // "The same for my other order": the second order is never named at all.
  {
    id: "TWO-04",
    customerId: "C018",
    receivedOn: "2026-10-05",
    subject: "Carafe damaged",
    body: "My glass carafe (O1030) arrived cracked. Please refund the $27.00, and do the same for my other order, it had the same problem. Arjun",
    tricky: true,
    history: [],
    expected: want("O1030", 2700, "send_to_human"),
  },
  // The amount asked is the sum of both orders ($27 + $38 = $65), so it can't fit on one.
  {
    id: "TWO-05",
    customerId: "C018",
    receivedOn: "2026-10-05",
    subject: "Refund of $65",
    body: "Orders O1030 and O1031 both arrived damaged, the carafe cracked and the tray split. I paid $65 in total, so please refund $65.00. Arjun",
    tricky: true,
    history: [],
    expected: want("O1030", 2700, "send_to_human"),
  },
  // The second order is named only by its item ("the oak serving tray too").
  {
    id: "TWO-06",
    customerId: "C018",
    receivedOn: "2026-10-05",
    subject: "Cracked carafe",
    body: "My glass carafe (O1030) arrived cracked, please refund it. The oak serving tray too, it came split. Arjun",
    tricky: true,
    history: [],
    expected: want("O1030", 2700, "send_to_human"),
  },
  // A delivered order plus an in-transit one; paying the delivered one alone hides the second ask.
  {
    id: "TWO-07",
    customerId: "C001",
    receivedOn: "2026-10-02",
    subject: "Mugs broken, napkins missing",
    body: "Two of the mugs in my set (O1001) arrived shattered, so I'd like the $24.00 back. My linen napkins (O1038) never showed up either, please refund those too. Mara",
    tricky: false,
    history: [],
    expected: want("O1001", 2400, "send_to_human"),
  },
  // Second order named only by its item: "the vase too" (O1039, still in transit).
  {
    id: "TWO-08",
    customerId: "C006",
    receivedOn: "2026-09-30",
    subject: "Coffee maker cracked",
    body: "The glass on my pour-over coffee maker (O1006) cracked out of the box. Please refund the $35.00, and the vase too. Dev",
    tricky: true,
    history: [],
    expected: want("O1006", 3500, "send_to_human"),
  },
  // Control: one order named, one order asked for. Should pay.
  {
    id: "TWO-C1",
    customerId: "C018",
    receivedOn: "2026-10-05",
    subject: "Carafe arrived cracked",
    body: "My glass carafe (O1030) arrived with a crack down the side. Could I get the $27.00 back? Arjun",
    tricky: false,
    history: [],
    expected: want("O1030", 2700, "allow"),
  },
  // Control: the second order is context only, no money asked on it, so it should pay.
  // An ID-counting R14 would send this to a person: its known false positive.
  {
    id: "TWO-C2",
    customerId: "C018",
    receivedOn: "2026-10-05",
    subject: "Carafe arrived cracked",
    body: "My glass carafe (O1030) arrived cracked. The serving tray from O1031 came fine and I love it, so only the carafe please: $27.00. Arjun",
    tricky: true,
    history: [],
    expected: want("O1030", 2700, "allow"),
  },
];
