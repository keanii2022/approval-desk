// The shop's written refund policy, for the refund agent and staff.
// The agent cites a line by its ID. Each hard rule from docs/RULES.md has its
// own line, starting with the rule's exact wording, then how to apply it.

export type PolicyLine = {
  id: string;
  section: "General" | "Hard rules";
  ruleId: string | null;
  text: string;
};

export const policyLines: PolicyLine[] = [
  {
    id: "P01",
    section: "General",
    ruleId: null,
    text: "Refunds are paid back to the original payment method, in US dollars.",
  },
  {
    id: "P02",
    section: "General",
    ruleId: null,
    text: "A customer can get a refund when an item arrives damaged, is faulty, never arrives, or is not what they ordered.",
  },
  {
    id: "P03",
    section: "General",
    ruleId: null,
    text: "A customer who changed their mind can get a refund for an item they haven't used.",
  },
  {
    id: "P04",
    section: "General",
    ruleId: null,
    text: "A refund can be partial when only part of an order is affected, for example one item in a set.",
  },
  {
    id: "P05",
    section: "General",
    ruleId: null,
    text: "Refunds cover the price paid for the order only. Other costs, such as damage to other things, time, or trouble, are not refunded.",
  },
  {
    id: "P06",
    section: "General",
    ruleId: null,
    text: "A refund can only be made on an order that belongs to the customer asking for it.",
  },
  {
    id: "P07",
    section: "General",
    ruleId: null,
    text: "If a message doesn't ask for a refund, no refund is proposed.",
  },
  {
    id: "P08",
    section: "Hard rules",
    ruleId: "R1",
    text: "A refund never exceeds the amount paid, counting earlier refunds. The most that can be refunded is the amount paid minus every earlier refund on that order. Asking for exactly that amount is allowed.",
  },
  {
    id: "P09",
    section: "Hard rules",
    ruleId: "R2",
    text: "A refund over $100 needs a human. Exactly $100.00 is not over $100; $100.01 is.",
  },
  {
    id: "P10",
    section: "Hard rules",
    ruleId: "R3",
    text: "An order older than 30 days needs a human. Age is counted in whole days from the day the order was placed to the day the request arrived. Exactly 30 days is not older; 31 days is.",
  },
  {
    id: "P11",
    section: "Hard rules",
    ruleId: "R4",
    text: "A customer with 3+ refunds in 90 days needs a human. Count the customer's earlier refunds, on any of their orders, made 90 days or fewer before the request arrived. The refund being asked for now doesn't count. A partial refund counts as one refund.",
  },
  {
    id: "P12",
    section: "Hard rules",
    ruleId: "R5",
    text: "An incomplete or malformed form is blocked.",
  },
  {
    id: "P13",
    section: "Hard rules",
    ruleId: "R6",
    text: "If the AI is down or unsure, send to a human.",
  },
  {
    id: "P14",
    section: "Hard rules",
    ruleId: "R7",
    text: "If the logbook can't write, the step doesn't happen.",
  },
  {
    id: "P15",
    section: "Hard rules",
    ruleId: "R8",
    text: "A refund must be on an order that belongs to the customer who asked. An order that belongs to someone else is blocked, even if the customer names it.",
  },
];
