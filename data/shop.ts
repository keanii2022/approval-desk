// Invented shop data. Every name, email, item, and order here is made up.
// Money is in cents (2400 = $24.00) so sums are always exact.
// Dates are YYYY-MM-DD. Nothing depends on today's date, so every seed run is identical.

export type Customer = { id: string; name: string; email: string };

export type Order = {
  id: string;
  customerId: string;
  placedOn: string;
  item: string;
  amountPaidCents: number;
};

export type Refund = {
  id: string;
  orderId: string;
  refundedOn: string;
  amountCents: number;
  reason: string;
};

export const customers: Customer[] = [
  { id: "C001", name: "Mara Lindqvist", email: "mara.lindqvist@example.com" },
  { id: "C002", name: "Theo Achterberg", email: "theo.achterberg@example.com" },
  { id: "C003", name: "Priya Raman", email: "priya.raman@example.com" },
  { id: "C004", name: "Jonah Whitcombe", email: "jonah.whitcombe@example.com" },
  { id: "C005", name: "Ines Kovač", email: "ines.kovac@example.com" },
  { id: "C006", name: "Dev Okafor", email: "dev.okafor@example.com" },
  { id: "C007", name: "Hollis Grange", email: "hollis.grange@example.com" },
  { id: "C008", name: "Saoirse Delaney", email: "saoirse.delaney@example.com" },
  { id: "C009", name: "Rafael Montoya", email: "rafael.montoya@example.com" },
  { id: "C010", name: "Wen Hsu", email: "wen.hsu@example.com" },
  { id: "C011", name: "Lucia Brennan", email: "lucia.brennan@example.com" },
  { id: "C012", name: "Tomasz Wierzbicki", email: "tomasz.wierzbicki@example.com" },
  { id: "C013", name: "Nadia Farouk", email: "nadia.farouk@example.com" },
  { id: "C014", name: "Elliot Marsh", email: "elliot.marsh@example.com" },
  { id: "C015", name: "Freya Holm", email: "freya.holm@example.com" },
  { id: "C016", name: "Kofi Mensah", email: "kofi.mensah@example.com" },
  { id: "C017", name: "Beatriz Salgado", email: "beatriz.salgado@example.com" },
  { id: "C018", name: "Arjun Mehta", email: "arjun.mehta@example.com" },
  { id: "C019", name: "Clara Vogel", email: "clara.vogel@example.com" },
  { id: "C020", name: "Sam Ellery", email: "sam.ellery@example.com" },
  { id: "C021", name: "Yuki Tanabe", email: "yuki.tanabe@example.com" },
  { id: "C022", name: "Oren Castell", email: "oren.castell@example.com" },
];

export const orders: Order[] = [
  { id: "O1001", customerId: "C001", placedOn: "2026-09-20", item: "Speckled ceramic mug set (4)", amountPaidCents: 2400 },
  { id: "O1002", customerId: "C002", placedOn: "2026-09-22", item: "Walnut desk lamp", amountPaidCents: 15000 },
  { id: "O1003", customerId: "C003", placedOn: "2026-09-15", item: "Linen throw blanket", amountPaidCents: 10000 },
  { id: "O1004", customerId: "C004", placedOn: "2026-09-18", item: "Stoneware dinner set", amountPaidCents: 10001 },
  { id: "O1005", customerId: "C005", placedOn: "2026-08-17", item: "Cast-iron skillet", amountPaidCents: 4200 },
  { id: "O1006", customerId: "C006", placedOn: "2026-09-01", item: "Glass pour-over coffee maker", amountPaidCents: 3500 },
  { id: "O1007", customerId: "C007", placedOn: "2026-08-31", item: "Cotton tea towels (3)", amountPaidCents: 2800 },

  // C008: three earlier refunds in the last 90 days, then a new order.
  { id: "O1008", customerId: "C008", placedOn: "2026-07-05", item: "Beeswax candles (2)", amountPaidCents: 3000 },
  { id: "O1009", customerId: "C008", placedOn: "2026-08-01", item: "Ceramic planter", amountPaidCents: 2200 },
  { id: "O1010", customerId: "C008", placedOn: "2026-09-02", item: "Bamboo utensil set", amountPaidCents: 1800 },
  { id: "O1011", customerId: "C008", placedOn: "2026-09-25", item: "Enamel kettle", amountPaidCents: 4600 },

  // C009: three earlier refunds, but only two in the last 90 days.
  { id: "O1012", customerId: "C009", placedOn: "2026-05-25", item: "Cotton dish cloths", amountPaidCents: 1500 },
  { id: "O1013", customerId: "C009", placedOn: "2026-08-10", item: "Ceramic soap dish", amountPaidCents: 2000 },
  { id: "O1014", customerId: "C009", placedOn: "2026-09-03", item: "Jute placemats (4)", amountPaidCents: 1200 },
  { id: "O1015", customerId: "C009", placedOn: "2026-09-24", item: "Glass storage jars (3)", amountPaidCents: 1950 },

  // C010 and C011 are a matched pair: same orders and refunds, except C010's
  // first refund is exactly 90 days before the request and C011's is 91 days.
  { id: "O1016", customerId: "C010", placedOn: "2026-06-28", item: "Pillar candle", amountPaidCents: 1600 },
  { id: "O1017", customerId: "C010", placedOn: "2026-08-14", item: "Ceramic pitcher", amountPaidCents: 2400 },
  { id: "O1018", customerId: "C010", placedOn: "2026-09-10", item: "Butter dish", amountPaidCents: 1400 },
  { id: "O1019", customerId: "C010", placedOn: "2026-09-26", item: "Enamel colander", amountPaidCents: 3300 },
  { id: "O1020", customerId: "C011", placedOn: "2026-06-27", item: "Pillar candle", amountPaidCents: 1600 },
  { id: "O1021", customerId: "C011", placedOn: "2026-08-14", item: "Ceramic pitcher", amountPaidCents: 2400 },
  { id: "O1022", customerId: "C011", placedOn: "2026-09-10", item: "Butter dish", amountPaidCents: 1400 },
  { id: "O1023", customerId: "C011", placedOn: "2026-09-26", item: "Enamel colander", amountPaidCents: 3300 },

  { id: "O1024", customerId: "C012", placedOn: "2026-09-19", item: "Bamboo cutting board", amountPaidCents: 4500 },
  { id: "O1025", customerId: "C013", placedOn: "2026-09-05", item: "Wool cushion covers (2)", amountPaidCents: 8000 },
  { id: "O1026", customerId: "C014", placedOn: "2026-09-08", item: "Rattan laundry basket with lid", amountPaidCents: 6000 },
  { id: "O1027", customerId: "C015", placedOn: "2026-09-06", item: "Copper measuring cups", amountPaidCents: 4000 },
  { id: "O1028", customerId: "C016", placedOn: "2026-08-10", item: "Standing floor mirror", amountPaidCents: 18000 },
  { id: "O1029", customerId: "C017", placedOn: "2026-09-21", item: "Upholstered footstool", amountPaidCents: 12000 },
  { id: "O1030", customerId: "C018", placedOn: "2026-09-12", item: "Glass carafe", amountPaidCents: 2700 },
  { id: "O1031", customerId: "C018", placedOn: "2026-09-14", item: "Oak serving tray", amountPaidCents: 3800 },
  { id: "O1032", customerId: "C019", placedOn: "2026-09-17", item: "Marble coasters (4)", amountPaidCents: 2200 },
  { id: "O1033", customerId: "C020", placedOn: "2026-09-23", item: "Hand-thrown vase", amountPaidCents: 3500 },
  { id: "O1034", customerId: "C021", placedOn: "2026-09-26", item: "Wall clock", amountPaidCents: 4800 },
  { id: "O1035", customerId: "C022", placedOn: "2026-09-20", item: "Linen apron", amountPaidCents: 2600 },
];

export const refunds: Refund[] = [
  { id: "RF001", orderId: "O1008", refundedOn: "2026-07-10", amountCents: 3000, reason: "Candles arrived melted" },
  { id: "RF002", orderId: "O1009", refundedOn: "2026-08-06", amountCents: 2200, reason: "Planter arrived cracked" },
  { id: "RF003", orderId: "O1010", refundedOn: "2026-09-08", amountCents: 900, reason: "Partial: two utensils missing from the set" },
  { id: "RF004", orderId: "O1012", refundedOn: "2026-06-01", amountCents: 1500, reason: "Wrong color sent" },
  { id: "RF005", orderId: "O1013", refundedOn: "2026-08-15", amountCents: 2000, reason: "Arrived chipped" },
  { id: "RF006", orderId: "O1014", refundedOn: "2026-09-10", amountCents: 1200, reason: "Changed mind, returned unused" },
  { id: "RF007", orderId: "O1016", refundedOn: "2026-07-03", amountCents: 1600, reason: "Arrived damaged" },
  { id: "RF008", orderId: "O1017", refundedOn: "2026-08-20", amountCents: 2400, reason: "Never arrived" },
  { id: "RF009", orderId: "O1018", refundedOn: "2026-09-15", amountCents: 700, reason: "Partial: lid missing" },
  { id: "RF010", orderId: "O1020", refundedOn: "2026-07-02", amountCents: 1600, reason: "Arrived damaged" },
  { id: "RF011", orderId: "O1021", refundedOn: "2026-08-20", amountCents: 2400, reason: "Never arrived" },
  { id: "RF012", orderId: "O1022", refundedOn: "2026-09-15", amountCents: 700, reason: "Partial: lid missing" },
  { id: "RF013", orderId: "O1025", refundedOn: "2026-09-12", amountCents: 4000, reason: "Partial: one cover arrived stained" },
  { id: "RF014", orderId: "O1026", refundedOn: "2026-09-14", amountCents: 2500, reason: "Partial: lid arrived cracked" },
  { id: "RF015", orderId: "O1027", refundedOn: "2026-09-11", amountCents: 4000, reason: "Wrong item sent" },
];
