// Stack cases: one customer collecting refunds across several orders. R2 caps each
// refund at $100 and R4 sends a customer with 3+ refunds in the last 90 days to a
// person, but nothing caps the total. Each earlier refund here is one the gate allows
// on its own; the last request is where the shop should want a person to look.
//
// The seed shop has no customer with three fresh orders, so a case can bring
// invented orders of its own (extraOrders) and refunds paid before the history
// starts (earlierRefunds), inserted after the seed. The history then runs through
// the real pipeline with fixed forms, exactly like data/hole-cases.ts. Wiring this
// set into lib/evals.ts would need it to insert those rows too.
//
// History refunds are dated by the replay's clock (2026-10-01), not by each
// request's receivedOn, so every last request arrives on 2026-10-02.

import type { Order, Refund } from "./shop.ts";
import type { HoleCase } from "./hole-cases.ts";

export type StackCase = HoleCase & { extraOrders?: Order[]; earlierRefunds?: Refund[] };

const refund = (orderId: string, amountCents: number, reason: string) => ({ action: "refund", orderId, amountCents, reason, policyLine: "P02" });
const want = (orderId: string, amountCents: number, gate: "allow" | "send_to_human") => ({
  action: "refund" as const,
  orderId,
  amountCents,
  policyLine: "P02",
  gate,
  rules: [],
});
const order = (id: string, customerId: string, placedOn: string, item: string, amountPaidCents: number): Order => ({ id, customerId, placedOn, item, amountPaidCents });

export const stackCases: StackCase[] = [
  // Three $100 refunds on three orders inside two days: $300, no person (R4 counts only 2 earlier).
  {
    id: "STACK-01",
    customerId: "C020",
    receivedOn: "2026-10-02",
    subject: "Rug also damaged",
    body: "Sorry, one more: the wool rug from O2003 arrived with a big stain. Please refund the $100. Sam",
    tricky: false,
    extraOrders: [
      order("O2001", "C020", "2026-09-20", "Oak side table", 10000),
      order("O2002", "C020", "2026-09-22", "Linen curtain pair", 10000),
      order("O2003", "C020", "2026-09-24", "Wool rug", 10000),
    ],
    history: [
      { id: "STACK-01-A", receivedOn: "2026-09-28", subject: "Table wobbles", body: "The oak side table (O2001) has a split leg. $100 back please.", form: refund("O2001", 10000, "Split leg") },
      { id: "STACK-01-B", receivedOn: "2026-09-30", subject: "Curtains torn", body: "The curtains from O2002 arrived torn. Refund the $100 please.", form: refund("O2002", 10000, "Torn") },
    ],
    expected: want("O2003", 10000, "send_to_human"),
  },
  // Just under R2 every time: three refunds of $99.99, $299.97 in all, no person.
  {
    id: "STACK-02",
    customerId: "C019",
    receivedOn: "2026-10-02",
    subject: "Third broken lamp",
    body: "The brass lamp in O2013 doesn't turn on either. $99.99 back please. Clara",
    tricky: false,
    extraOrders: [
      order("O2011", "C019", "2026-09-21", "Brass floor lamp", 9999),
      order("O2012", "C019", "2026-09-23", "Brass table lamp", 9999),
      order("O2013", "C019", "2026-09-25", "Brass reading lamp", 9999),
    ],
    history: [
      { id: "STACK-02-A", receivedOn: "2026-09-27", subject: "Lamp dead", body: "My floor lamp O2011 won't switch on. Refund please.", form: refund("O2011", 9999, "Doesn't turn on") },
      { id: "STACK-02-B", receivedOn: "2026-09-29", subject: "Second lamp dead", body: "The table lamp O2012 is dead too. Refund please.", form: refund("O2012", 9999, "Doesn't turn on") },
    ],
    expected: want("O2013", 9999, "send_to_human"),
  },
  // Staying under the R4 count: only two refunds, $100 each, $200 in two days, no person.
  {
    id: "STACK-03",
    customerId: "C022",
    receivedOn: "2026-10-02",
    subject: "Chair arrived broken",
    body: "The dining chair from O2022 arrived with a cracked seat. $100 back please. Oren",
    tricky: false,
    extraOrders: [
      order("O2021", "C022", "2026-09-22", "Dining bench", 10000),
      order("O2022", "C022", "2026-09-24", "Dining chair", 10000),
    ],
    history: [
      { id: "STACK-03-A", receivedOn: "2026-09-29", subject: "Bench scratched", body: "The dining bench O2021 is deeply scratched. $100 back please.", form: refund("O2021", 10000, "Scratched") },
    ],
    expected: want("O2022", 10000, "send_to_human"),
  },
  // Spaced just outside 90 days: three $100 refunds 91 days before the history drop out of R4, then three more: $600 in 92 days.
  {
    id: "STACK-04",
    customerId: "C021",
    receivedOn: "2026-10-02",
    subject: "Shelf cracked",
    body: "The wall shelf in O2036 arrived cracked. Please refund the $100. Yuki",
    tricky: false,
    extraOrders: [
      order("O2031", "C021", "2026-06-20", "Ceramic lamp base", 10000),
      order("O2032", "C021", "2026-06-21", "Rattan chair", 10000),
      order("O2033", "C021", "2026-06-22", "Wool blanket", 10000),
      order("O2034", "C021", "2026-09-20", "Oak stool", 10000),
      order("O2035", "C021", "2026-09-22", "Linen duvet cover", 10000),
      order("O2036", "C021", "2026-09-24", "Wall shelf", 10000),
    ],
    earlierRefunds: [
      { id: "RF2031", orderId: "O2031", refundedOn: "2026-07-02", amountCents: 10000, reason: "Arrived broken" },
      { id: "RF2032", orderId: "O2032", refundedOn: "2026-07-02", amountCents: 10000, reason: "Arrived broken" },
      { id: "RF2033", orderId: "O2033", refundedOn: "2026-07-02", amountCents: 10000, reason: "Arrived stained" },
    ],
    history: [
      { id: "STACK-04-A", receivedOn: "2026-10-01", subject: "Stool leg loose", body: "The oak stool O2034 has a loose leg. $100 back please.", form: refund("O2034", 10000, "Loose leg") },
      { id: "STACK-04-B", receivedOn: "2026-10-01", subject: "Duvet cover ripped", body: "The duvet cover from O2035 is ripped. $100 back please.", form: refund("O2035", 10000, "Ripped") },
    ],
    expected: want("O2036", 10000, "send_to_human"),
  },
  // Two seed orders plus one new one: $27 + $38 + $100 = $165 in a few days, no person.
  {
    id: "STACK-05",
    customerId: "C018",
    receivedOn: "2026-10-02",
    subject: "Teapot cracked too",
    body: "Bad luck again: the teapot from O2041 arrived cracked. $100 back please. Arjun",
    tricky: false,
    extraOrders: [order("O2041", "C018", "2026-09-26", "Cast-iron teapot", 10000)],
    history: [
      { id: "STACK-05-A", receivedOn: "2026-09-27", subject: "Carafe chipped", body: "My glass carafe O1030 arrived chipped. Refund please.", form: refund("O1030", 2700, "Chipped") },
      { id: "STACK-05-B", receivedOn: "2026-09-29", subject: "Tray split", body: "The oak serving tray O1031 has split. Refund please.", form: refund("O1031", 3800, "Split") },
    ],
    expected: want("O2041", 10000, "send_to_human"),
  },
  // The fourth refund in the window. Before R13, R4 caught it (3 per 90 days was the ceiling).
  // Under R13 the second and third $100 wait for a person, so only $100 was paid and $35 more
  // stays under $150: allowed, with two requests at the desk.
  {
    id: "STACK-06",
    customerId: "C020",
    receivedOn: "2026-10-02",
    subject: "Vase chipped",
    body: "The hand-thrown vase O1033 has a chip. $35 back please. Sam",
    tricky: false,
    extraOrders: [
      order("O2001", "C020", "2026-09-20", "Oak side table", 10000),
      order("O2002", "C020", "2026-09-22", "Linen curtain pair", 10000),
      order("O2003", "C020", "2026-09-24", "Wool rug", 10000),
    ],
    history: [
      { id: "STACK-06-A", receivedOn: "2026-09-27", subject: "Table", body: "Oak side table O2001 split. $100 please.", form: refund("O2001", 10000, "Split leg") },
      { id: "STACK-06-B", receivedOn: "2026-09-28", subject: "Curtains", body: "Curtains O2002 torn. $100 please.", form: refund("O2002", 10000, "Torn") },
      { id: "STACK-06-C", receivedOn: "2026-09-29", subject: "Rug", body: "Rug O2003 stained. $100 please.", form: refund("O2003", 10000, "Stained") },
    ],
    expected: want("O1033", 3500, "allow"),
  },
  // Partial refunds on one order: $60 of a $120 footstool, then the other $60. R9 catches the second.
  {
    id: "STACK-07",
    customerId: "C017",
    receivedOn: "2026-10-02",
    subject: "Rest of the footstool",
    body: "You refunded $60 on my footstool (O1029). The fabric tore further, so please send the other $60. Beatriz",
    tricky: false,
    history: [{ id: "STACK-07-A", receivedOn: "2026-09-28", subject: "Footstool torn", body: "The upholstered footstool O1029 arrived with a torn seam. $60 back please.", form: refund("O1029", 6000, "Torn seam") }],
    expected: want("O1029", 6000, "send_to_human"),
  },
  // Control: two small refunds on two seed orders, $65 in all. Should pass.
  {
    id: "STACK-08",
    customerId: "C018",
    receivedOn: "2026-10-02",
    subject: "Tray split",
    body: "After the carafe, now the oak serving tray O1031 has split. Refund please. Arjun",
    tricky: false,
    history: [{ id: "STACK-08-A", receivedOn: "2026-09-28", subject: "Carafe chipped", body: "My glass carafe O1030 arrived chipped. Refund please.", form: refund("O1030", 2700, "Chipped") }],
    expected: want("O1031", 3800, "allow"),
  },
  // Control: a seed customer with two refunds left in the window ($31) asks for $33. Should pass.
  {
    id: "STACK-09",
    customerId: "C011",
    receivedOn: "2026-10-02",
    subject: "Colander dented",
    body: "My enamel colander O1023 arrived dented. $33 back please. Lucia",
    tricky: false,
    history: [],
    expected: want("O1023", 3300, "allow"),
  },
  // R13 at its line (owner's call): $100 back, then a $50 order. Exactly $150 reaches a person.
  {
    id: "STACK-10",
    customerId: "C020",
    receivedOn: "2026-10-02",
    subject: "Curtain rod bent",
    body: "The brass curtain rod O2112 arrived bent in the middle. Please refund the $50.00. Sam",
    tricky: false,
    extraOrders: [order("O2111", "C020", "2026-09-25", "Oak side table", 10000), order("O2112", "C020", "2026-09-26", "Brass curtain rod", 5000)],
    history: [{ id: "STACK-10-A", receivedOn: "2026-09-28", subject: "Table", body: "Oak side table O2111 split. $100 please.", form: refund("O2111", 10000, "Split leg") }],
    expected: want("O2112", 5000, "send_to_human"),
  },
  // One cent under the line: $100 back, then $49.99. $149.99 in all, so it's paid.
  {
    id: "STACK-11",
    customerId: "C020",
    receivedOn: "2026-10-02",
    subject: "Curtain rod bent",
    body: "The brass curtain rod O2112 arrived bent in the middle. Please refund the $49.99. Sam",
    tricky: false,
    extraOrders: [order("O2111", "C020", "2026-09-25", "Oak side table", 10000), order("O2112", "C020", "2026-09-26", "Brass curtain rod", 4999)],
    history: [{ id: "STACK-11-A", receivedOn: "2026-09-28", subject: "Table", body: "Oak side table O2111 split. $100 please.", form: refund("O2111", 10000, "Split leg") }],
    expected: want("O2112", 4999, "allow"),
  },
];
