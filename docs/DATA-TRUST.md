# Which rules trust which data

The gate checks the agent's form, but it takes the shop's own tables at their word.
This is what each rule reads, what goes wrong today if that data is wrong, and the
guard that would stop it. Cases: `tests/bad-data.test.ts` (holes are `it.fails`).

What the tables already refuse: NULL anywhere a rule reads, amounts of 0 or below
written as numbers, duplicate refund IDs, and (with foreign keys on, which
`openDatabase` sets) orders or requests for a customer who doesn't exist,
including `c001` or `C001 ` for `C001`.

The gap: SQLite's `CHECK (x > 0)` counts any text as bigger than any number, so
`'abc'` or `'-500x'` passes it. The gate also compares flags with `=== 1` and
dates with `Date.parse`, so a value it can't read counts as "no problem".

| Rule | Trusts | If it's wrong today | Proposed guard |
|---|---|---|---|
| R1 over amount paid | `orders.amount_paid_cents`, `refunds.amount_cents` (sum) | **Hole.** A refund of `'-500x'` sums as -500, so 2,900 is paid on a 2,400 order. An order amount of `'abc'` makes the check `x > NaN`, always false, so any amount is paid. | `CHECK (typeof(amount_paid_cents) = 'integer' AND amount_paid_cents > 0)` and the same on `refunds.amount_cents`. Gate: if either isn't a whole number, block (R5). |
| R2 over $100 | the form only | Not affected. | None. |
| R3 older than 30 days | `orders.placed_on`, `inbox.received_on` | **Hole.** An unreadable date (`soon`, `2026-13-45`) or a future one skips R3. | `CHECK (date(placed_on) = placed_on)` (and on `received_on`). Gate: an age that isn't a number 0 or more goes to a person. |
| R4 3+ refunds in 90 days | `refunds.refunded_on`, `orders.customer_id` | **Hole.** A refund dated in the future or unreadable isn't counted. | `CHECK (date(refunded_on) = refunded_on)`. Gate: count refunds with an unreadable or future date as recent. |
| R5 order exists | `orders.id` | Safe: a missing order is blocked. | None. |
| R6 AI down / unsure | the form only | Not affected. | None. |
| R7 logbook writes | the logbook | Not data from the shop. | None. |
| R8 own order | `orders.customer_id`, `inbox.customer_id` | Safe: any mismatch (case, spaces) blocks. Only wrong if the order is filed under the wrong customer exactly. | None needed; foreign keys already catch typos. |
| R9 second refund | `refunds` for the order (sum > 0), logbook | **Hole.** A refund amount of `'abc'` sums to 0, so the earlier refund is invisible and the full amount goes out again. | The R1 type CHECK. Gate: test "any refund row exists", not "sum > 0". |
| R10 flagged or new | `customers.flagged`, `customers.joined_on` | **Hole.** `flagged = 'true'` or `2` reads as not flagged; an unreadable `joined_on` looks old; with foreign keys off, a missing customer passes. **Needless send:** a flag that should have been lifted still sends to a person. | `CHECK (flagged IN (0, 1))`, `CHECK (date(joined_on) = joined_on)`. Gate: no customer row → person. |
| R11 in transit | `orders.in_transit` | **Hole.** `2` or `'yes'` reads as delivered. A status stuck at 0 after a parcel went missing can't be seen at all. **Needless send:** a delivered parcel still marked 1. | `CHECK (in_transit IN (0, 1))`. A stale carrier status needs a fresh carrier check, which is out of scope. |
| R12 names an unknown order | `orders.id`, `orders.customer_id` | Errs safe: an order filed under the wrong customer sends to a person. | None. |
| R13 over $150 in 90 days | `refunds.amount_cents`, `refunds.refunded_on`, `orders.customer_id` | Not on this branch yet. Same weak spots as R1 and R4: a `'-500x'` refund lowers the 90-day total; a future date drops one. | The R1 and R4 guards cover it. |
| R14 email names 2+ own orders | `orders.id`, `orders.customer_id` | Not on this branch yet. Errs safe like R12. | None. |

Foreign keys: `openDatabase` turns them on, but a shop file edited with the
`sqlite3` tool has them off, so the gate shouldn't rely on them alone (R10 guard above).
