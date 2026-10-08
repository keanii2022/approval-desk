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
