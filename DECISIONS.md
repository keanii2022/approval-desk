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
