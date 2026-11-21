# Hard rules

These never change to make something pass. Each rule has an ID so the gate
can name it in its result and tests can point to it
(for example, "R2: refund over $100 goes to a human").

| ID | Rule | Result | Applies to | Checked by |
|----|------|--------|------------|------------|
| R1 | A refund never exceeds the amount paid, counting earlier refunds. | Block | Agent proposals **and** the human approver | Gate, approval screen, executor |
| R2 | A refund over $100 needs a human. | Send to human | Agent proposals | Gate |
| R3 | An order older than 30 days needs a human. | Send to human | Agent proposals | Gate |
| R4 | A customer with 3+ refunds in 90 days needs a human. | Send to human | Agent proposals | Gate |
| R5 | An incomplete or malformed form is blocked. | Block | Agent output | Gate |
| R6 | If the AI is down or unsure, send to a human. | Send to human | Agent output | Gate |
| R7 | If the logbook can't write, the step doesn't happen. | Step doesn't happen | Every step | Logbook, executor |
| R8 | A refund must be on an order that belongs to the customer who asked. | Block | Agent proposals **and** the human approver | Gate, approval screen, executor |
| R9 | A second refund on one order needs a human: the order was refunded before, or another request on it is waiting for a person. | Send to human | Agent proposals | Gate |
| R10 | A flagged account, or one opened 30 days or fewer before the request, needs a human. | Send to human | Agent proposals | Gate |
| R11 | A refund on an order the carrier hasn't delivered yet needs a human. | Send to human | Agent proposals | Gate |
| R12 | A message that names an order number that isn't one of the customer's orders needs a human. | Send to human | Agent proposals | Gate |
| R13 | A refund that would bring what one customer got back in 90 days to $150 or more, counting earlier refunds on any of their orders, needs a human. | Send to human | Agent proposals | Gate |
| R14 | A message that asks about two or more of the customer's own orders needs a human. | Send to human | Agent proposals | Gate |

## Where each rule is tested

| ID | Tested in step |
|----|----------------|
| R1 | 3 (gate), 4 (executor), 7 (approval screen) |
| R2 | 3, 6 |
| R3 | 3 |
| R4 | 3 |
| R5 | 3, 5 |
| R6 | 3, 5 |
| R7 | 4 |
| R8 | 3 (gate), 4 (executor), 7 (approval screen) |
| R9 | Added 2026-11-19 (gate tests, `npm run probe`) |
| R10 | Added 2026-11-19 (gate tests, `npm run probe`) |
| R11 | Added 2026-11-20 (gate tests, hole cases HOLE-13 to 15) |
| R12 | Added 2026-11-21 (gate tests, hole cases HOLE-16 to 19); order-number scan made stricter 2026-11-21 (disguise cases DISG-01 to 23, field cases FIELD-08 to 10) |
| R13 | Added 2026-11-21 (gate tests, stack cases STACK-01 to 09, tests/concurrency.test.ts) |
| R14 | Added 2026-11-21 (gate tests, two-order cases TWO-01 to 08 and HARD-060) |

## Open questions (settled in steps 2 and 3, and after step 5)

Record each answer here and in `DECISIONS.md`.

| # | Question | Rule | Settle in | Answer |
|---|----------|------|-----------|--------|
| Q1 | Is exactly $100 "over $100"? | R2 | Step 2 | No. Exactly $100.00 doesn't need a human; $100.01 does. |
| Q2 | Is exactly 30 days "older than 30 days"? | R3 | Step 2 | No. 31 days is. Age runs from the day the order was placed to the day the request arrived. |
| Q3 | Does "3+ refunds in 90 days" count this one? | R4 | Step 2 | No. Only earlier refunds count, on any of the customer's orders, made 90 days or fewer before the request arrived. |
| Q4 | Which result wins when several rules apply? | All | Step 3 | The strictest: block, then send to human, then allow. The gate names every rule behind that result (for example R2 and R3 together). A malformed form (R5) is blocked before any other rule is checked. |
| Q5 | What counts as the AI being "unsure"? | R6 | Step 3 | Only the agent saying so, by choosing the action "unsure" on its form. The gate doesn't guess from wording or confidence scores. An unsure form goes to a human whatever amount it suggests; the human's amount is still held to R1. "Down" means no answer at all. |
| Q6 | Does a refund on someone else's order block or go to a human? | R8 | After step 5 | Block. It is stricter than sending it to a person, and the person can't override it: the order a person picks must also be the asking customer's own (R8 applies to the approval screen and the executor too). An "unsure" form isn't checked, because nothing on it is carried out. |
| Q7 | Why R9? | R9 | 2026-11-19 | R2 looks at one request at a time, so a $150 refund asked for as two $75 requests was paid with no person involved, and the same claim sent twice was paid twice. A probe (`npm run probe`) showed both. Now any refund on an order that was refunded before, or that already has a request waiting for a person, goes to a person. R1 still blocks anything over what's left. |
| Q8 | What counts as a flagged or new account? | R10 | 2026-11-19 | Flagged is a mark on the customer in the shop data. New means the account was opened 30 days or fewer before the request arrived, counted like R3. A long-standing customer with no mark passes. Customers made by "Someone new" on the try page have no orders, so R8 already blocks their refunds. |
| Q9 | Why R11, and what counts as not delivered? | R11 | 2026-11-20 | Three hole cases asked for refunds on orders the carrier still shows in transit. On R1–R10 the agent proposed a refund every time and the gate paid all 9 answers. "Not delivered" is the carrier's status on the order in the shop data, not what the customer says; an order marked delivered that the customer says never came is still the agent's call under the policy. |
| Q10 | Why R12, and how is an order number spotted? | R12 | 2026-11-21 | Twice the agent answered "no refund" to a request about an order that doesn't exist (CASE-046, HARD2-014), turning a customer away with no person checking. A hole case then showed it refunding the customer's real order while ignoring a made-up one in the same email. The gate now finds every order number in the subject and message (the letter O followed by four or more digits) and sends the request to a person if any of them isn't the customer's own. R8 still blocks a refund on someone else's order outright, since blocking is stricter. |
| Q11 | Why R13, and what counts? | R13 | 2026-11-21 | R2 caps each refund at $100 and R4 allows two earlier refunds, so one customer could get three $100 refunds on three orders, $300 in two days, and a new batch every 91 days: $1,500 a year with no person (STACK-01 to 05). R13 adds up every refund paid to the customer, on any of their orders, 90 days or fewer before the request, plus this one. $150 or more goes to a person (owner's call, 2026-11-21: $100 and then $50 should reach a person). It only applies when there's at least one earlier refund, so a single big refund stays R2's job. The window matches R4's. |
| Q12 | Why R14, and how are orders counted? | R14 | 2026-11-21 | HARD-060 named two of the customer's own orders and the agent paid one of them, 3 runs out of 3 (TWO-01 to 08 found the same). The gate counts the distinct order numbers in the subject and message that belong to the customer; two or more go to a person, for a refund or a no-refund. Known misses: "my other order" and an order named only by its item, which plain code can't see. Known false catch: a second order mentioned only in passing (TWO-C2) also goes to a person. |
| Q13 | How strict is the order-number scan (R12, R14) and the date check (R3, R4, R10, R13)? | R12, R14, R3, R4, R10, R13 | 2026-11-21 | Order numbers: the text is cleaned before matching (full-width and look-alike characters, accents, invisible and direction characters, other scripts' digits, a Cyrillic or Greek O), then "O-1002", "0rder 01002", "order #1,002", "Order No. 1002" and a bare "#1002" all count as O1002. A bare 1002 or a number in words isn't caught; that's left to the agent. Dates: only a real YYYY-MM-DD counts. A date that can't be read, a request dated before its order, or an account opened after its request all go to a person. Refunds dated after the request still count toward R4 and R13 (they were paid while it waited). The tables refuse such rows too (lib/seed.ts). |
