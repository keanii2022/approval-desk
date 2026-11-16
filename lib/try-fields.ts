// What the try page's form and the server agree on. Kept apart from lib/tryout.ts
// because the form runs in the browser and can't load the database code.

export const SUBJECT_MAX = 120;
export const MESSAGE_MAX = 2000;
export const NAME_MAX = 60;

// customerId NEW_CUSTOMER means "someone the shop has never seen": a customer is
// made with the typed name and no orders, so any refund they ask for should fail.
export const NEW_CUSTOMER = "new";

export type ReceiptOrder = {
  id: string;
  item: string;
  placedOn: string;
  paid: string;
  refunded: string;
  left: string;
  paidCents: number;
  leftCents: number;
};
export type ReceiptCustomer = { id: string; name: string; orders: ReceiptOrder[] };
