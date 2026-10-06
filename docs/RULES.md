# Hard rules

These never change to make something pass. Each rule has an ID so the gate
can name it in its result and tests can point to it
(for example, "R2: refund over $100 goes to a human").

| ID | Rule | Result | Applies to | Checked by |
|----|------|--------|------------|------------|
| R1 | A refund never exceeds the amount paid, counting earlier refunds. | Block | Agent proposals **and** the human approver | Gate, approval screen |
| R2 | A refund over $100 needs a human. | Send to human | Agent proposals | Gate |
| R3 | An order older than 30 days needs a human. | Send to human | Agent proposals | Gate |
| R4 | A customer with 3+ refunds in 90 days needs a human. | Send to human | Agent proposals | Gate |
| R5 | An incomplete or malformed form is blocked. | Block | Agent output | Gate |
| R6 | If the AI is down or unsure, send to a human. | Send to human | Agent output | Gate |
| R7 | If the logbook can't write, the step doesn't happen. | Step doesn't happen | Every step | Logbook, executor |

## Where each rule is tested

| ID | Tested in step |
|----|----------------|
| R1 | 3 (gate), 7 (approval screen) |
| R2 | 3, 6 |
| R3 | 3 |
| R4 | 3 |
| R5 | 3, 5 |
| R6 | 3, 5 |
| R7 | 4 |

## Open questions (settle in steps 2 and 3)

Record each answer here and in `DECISIONS.md`.

| # | Question | Rule | Settle in | Answer |
|---|----------|------|-----------|--------|
| Q1 | Is exactly $100 "over $100"? | R2 | Step 2 | _open_ |
| Q2 | Is exactly 30 days "older than 30 days"? | R3 | Step 2 | _open_ |
| Q3 | Does "3+ refunds in 90 days" count this one? | R4 | Step 2 | _open_ |
| Q4 | Which result wins when several rules apply? | All | Step 3 | _open_ |
| Q5 | What counts as the AI being "unsure"? | R6 | Step 3 | _open_ |
