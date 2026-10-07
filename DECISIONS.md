# Decisions

One entry per step, added at the end of that step's session. Newest at the bottom.

Template:

```
## Step N: <name> (YYYY-MM-DD)

**Built:** what now exists, in plain words.
**Decided:** choices made and why, including any open questions from docs/RULES.md answered.
**Left for later:** anything noticed but kept out of scope.
```

## Entries

## Step 1: Skeleton (2026-10-05)

**Built:** An empty Next.js app with TypeScript, plus Vitest with one sample test that passes. Git is set up. `npm test` runs the tests; `npm run build` builds the app.
**Decided:**
- Set up Next.js by hand instead of using the starter generator, so nothing extra (styling kit, linter, sample pages) came along.
- Tests live in `tests/`. Vitest runs on its default settings; no config file yet.
- `.env`, `.env.*`, and `private/` were already excluded in `.gitignore`; checked with `git check-ignore`. `.env.example` stays tracked. Added Next.js build output and macOS `.DS_Store` files to the ignore list.
- `"private": true` in `package.json` so the project can't be published to npm by accident.
**Left for later:** No linter or formatter; neither is in the stack list.

## Step 2: Shop data, Inbox, and policy (2026-10-05)

**Built:** An invented shop (22 customers, 35 orders, 15 past refunds), a 14-line refund policy, and an Inbox of 22 customer requests, all loaded into SQLite by `npm run seed`. Tests prove that seeding twice gives identical data, that every hard rule (R1 to R7) appears word for word in the policy, and that each Inbox example really sits where it claims (over a limit, under it, or exactly on the edge).
**Decided:**
- Q1: exactly $100.00 is not "over $100"; $100.01 is.
- Q2: exactly 30 days is not "older than 30 days"; 31 days is. Age runs from the day the order was placed to the day the request arrived.
- Q3: the refund being asked for doesn't count. Only earlier refunds count, on any of the customer's orders, made 90 days or fewer before the request arrived (so one exactly 90 days before counts). A partial refund counts as one.
- All three follow the rules' plain wording, rather than the stricter reading.
- Used the SQLite built into Node instead of adding a database package, so nothing new was installed.
- Money is stored in cents so sums are exact. All dates are fixed, never "today", so the data never changes between runs.
- Inbox examples cover each rule and both sides of each edge, plus two requests that hit two rules at once (for Q4 in step 3). R7 has no Inbox example: it's about the logbook failing, tested in step 4.
- Added policy line P06: a refund can only be made on the customer's own order. It's guidance for the agent, not a hard rule. REQ-022 tests it.
- The database file is `data/approval-desk.db`, kept out of git. Added `"type": "module"` to `package.json` and allowed `.ts` import paths in `tsconfig.json` so Node can run the seed script directly.
**Left for later:** Nothing stops a refund on someone else's order except the agent following P06. Whether that should become a hard rule (checked by the gate) is the owner's call.

## Step 3: Gate (2026-10-05)

**Built:** The gate (`lib/gate.ts`): plain code, no AI. It takes the agent's answer to an Inbox request, checks it against the shop data, and returns allow, send to human, or block, naming the rules behind the result. It checks R1 to R6. Tests cover each rule using the Inbox examples on both sides of every edge, and feed in 1,000 bad proposals; none is allowed. Weakening the $100 limit on purpose made that test fail at once, so it really checks.
**Decided:**
- Added an order field to the agent's form, with the owner's OK. Without it the gate can't tell which order to check for R1 and R3. Updated step 5 in `docs/PLAN.md` and `docs/ARCHITECTURE.md`.
- The form has five fields: action (`refund`, `no_refund`, or `unsure`), order, amount in cents (like the shop data), reason, and policy line. A refund needs an order that exists and an amount. A no-refund answer has no amount. An unsure answer may leave both empty.
- Q4: the strictest result wins: block, then send to human, then allow. The gate names every rule behind that result, so a human sees all the reasons (for example R2 and R3 together).
- Q5: the AI is unsure only when it says so, by choosing `unsure`. No guessing from wording or confidence scores, which an AI can make up. An unsure answer goes to a human whatever amount it suggests; the approval screen still holds that human to R1. "Down" means no answer at all.
- R5 covers more than missing fields: a wrong type, an extra field, an amount that isn't a whole number of cents above zero, a policy line that doesn't exist, or a refund on an order that doesn't exist are all blocked.
- R1 counts every refund on the order, whenever it was made, so the total can never pass the amount paid.
- R4 counts the refunds of the customer who is asking.
- A no-refund answer is allowed with no further checks, since nothing changes.
- The 1,000 bad proposals are made from a fixed random starting point inside the test, so every run uses the same ones. No new package.
**Left for later:**
- P06 is still not checked by the gate: a refund on another customer's order gets through if no other rule stops it. Still the owner's call (noted in step 2).
- The gate stops with an error for a request ID that isn't in the Inbox, instead of returning a result. Step 6 decides how the path handles that.

## Step 4: Executor and logbook (2026-10-07)

**Built:** The logbook (`lib/logbook.ts`), a table that only grows: lines can't be changed, deleted, or overwritten. It writes down the gate's decisions and a person's approvals. The executor (`lib/executor.ts`), the only code that adds a refund. It takes a logbook line number, never a proposal, and pays only for a gate "allow" or a person's approval of something the gate sent to a person. It writes its "refund done" line and the refund in one all-or-nothing save. Tests prove that every way of skipping the gate is refused, and that a broken or full logbook means no refund (R7). Breaking the code on purpose in a copy (about 20 different ways) made the tests fail each time.
**Decided:** (owner approved each of these)
- The executor checks R1 again at the moment of paying. Two refunds that are each fine alone can add up to more than was paid. Added the executor to R1's "Checked by" and "Tested in" columns in `docs/RULES.md`. This makes R1 stricter, not looser.
- One refund per Inbox request, so a retry or an old approval can't pay the same request twice.
- Gate decisions are written to the logbook now (a small piece of Step 6). The executor can only tell "the gate allowed it" from "skipped the gate" by checking the log. The gate checks the exact copy that gets written, and the executor runs the gate again on it before paying, so a hand-written "allow" line gets nowhere.
- A person picks the order only when the agent's form named none (the AI was down or unsure). Added to Step 7's goal in `docs/PLAN.md` and to `docs/ARCHITECTURE.md`.
- Added `export` to one helper in `lib/gate.ts` (the "refunded so far" sum), so the gate and the executor can never disagree about what's left on an order. Nothing about how the gate works changed.
- Tests that check no rule ID are labelled "Executor:" or "Logbook:" instead of adding a new rule.
- A person's approval gets the fixed refund reason "Approved by a person (logbook line N)", since a request where the AI was down has no reason to copy.
- Refund numbers continue from RF016 and never repeat, even after the shop data is reloaded.
- Times are UTC, like 2026-10-05T14:03:11Z, and must be real dates. The refund date is the date part.
- Refusals are not written to the logbook yet.
**Left for later:**
- What reloading the shop data (`npm run seed`) should do to the logbook. Today the logbook is kept, but the refunds it describes are wiped. Decide before the Step 10 demo.
- Logging the executor's refusals, such as skipped-gate attempts: Step 6.
- A person's reject (note required), holding the person to R1 when they decide, and recording who the person was: Step 7.
- A wait time for a busy database, once the Step 7 server and scripts share the file. For now a busy database stops with nothing changed.
- The Step 9 eval runner should call the gate directly on a copy of the data, so it never creates approvals.
- Limit: anyone holding the database file can still drop the logbook table or add refunds directly. The guarantees hold for everything that goes through the app's code.
- P06 (refund only on the customer's own order) is still not a hard rule, including for an order a person picks.
