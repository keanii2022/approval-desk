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

## Village prototype, built before Step 11 (2026-10-07)

**Built:** A playable pixel-art village (`prototypes/village/index.html`) that shows the whole path: the robot agent fetches a request from the Inbox, the gate lights green, yellow or red, a person decides big refunds at the human desk, the factory pays, and a logbook window lists recent decisions with the agent's reason, the gate's verdict and the final outcome. It runs on scripted, invented data and no AI calls. Checked by simulating about eight minutes of play, including approving and rejecting at the desk.
**Decided:** (owner approved each of these)
- A person always decides at the human desk. There is no timer and no auto-approve, so nothing can be paid without a person saying yes.
- Rules are shown in plain words ("over the $100 limit, needs a human"), never as rule numbers.
- Walking speed stays the same; popups stay up longer, because time slows while the agent stands still. A speed button and a pause key were added.
- The logbook is labelled "add-only record", because the agent only suggests; it never writes the record. It holds only what really happened during the visit, with numbers continuing from RF016.
- The look is a calm dusk palette, with a day palette as an option.
**Left for later:**
- Step 11 rebuilds this in TypeScript and Next.js, on live data after Step 6. The prototype is plain HTML, outside the stack list, so it stays a reference only.
- The agent's reasons in the logbook are written by hand for the demo. Real ones come from the form's reason field.
- Playwright tests and a full accessibility check belong to Step 11.
- Whether the village should also show R3 to R6 rules (old order, many refunds, garbled form, AI down).

## R8: a refund must be on the asking customer's own order (2026-10-07)

**Built:** A new hard rule, R8, in the gate and the executor. The gate blocks a refund on an order that belongs to someone else, and names R8. The executor checks it again when a person's approval is paid, so a person can't approve a refund on someone else's order either. R8 is in `docs/RULES.md`, in the policy as P15 (word for word, as the policy test requires), and in the tests. Breaking R8 on purpose in the gate failed 5 tests, and in the executor failed 1.
**Decided:** (owner approved)
- This turns policy line P06 into a hard rule. Until now only the agent's care stood between a customer and a refund on someone else's order.
- The result is Block, not Send to human (Q6 in `docs/RULES.md`). It is stricter, and a person can't override it.
- An "unsure" form naming someone else's order still goes to a person for R6, and a no-refund answer is still allowed, because nothing on either is carried out. The person then picks from the asking customer's own orders only (Step 7).
- Several old tests paired a request with another customer's order, because nothing checked it. They now use the asking customer's own orders (the executor tests add a second request for the same customer). The "1,000 bad proposals" test gains an R8 case, so all 1,000 still stop. Nothing was loosened.
**Left for later:**
- Step 7's order picker must list only the asking customer's orders.
- The village prototype's rules window still shows seven rules.
- The agent's instructions are unchanged. It already sees only the asking customer's orders; the evals will show whether it still suggests a stranger's order.

## Step 6: Connect the path (2026-10-07)

**Built:** `processRequest` (`lib/pipeline.ts`) runs one Inbox request from start to finish: the agent suggests, the gate decides and writes it down, and then the request is paid by the executor (allow), waits in the human queue (send to human), or stops (block). `humanQueue` lists the requests waiting for a person. The logbook gained one line type, "refund refused" (`logRefusal`), so an executor refusal leaves a trace. Tests use a stand-in agent that hands over a fixed form; it never reads the request. A small refund is paid, a $150 refund waits for a person, an impossible one is blocked, and all three are in the logbook. Breaking the pipeline on purpose in ten ways failed the tests each time. An independent review found two gaps (below); both are fixed.
**Decided:**
- Each request runs once. The check is repeated, locked, right before the gate's line is written, so two runs of one request at the same moment end with one line and one payment.
- A request that isn't in the Inbox stops at once: the agent isn't asked and nothing is written. (This was left open in Step 3.)
- The human queue is read straight from the logbook (gate lines sent to a person that no person has decided), so there is no second list to disagree with the record.
- An allowed refund that was interrupted (the executor threw, or the program stopped) is paid when the same request is run again. The executor pays each request at most once, so this is safe. A request with a refusal on record stays settled.
- Executor refusals are written to the logbook. (This was left open in Step 4.)
- If the logbook can't write the gate's line, nothing else happens (R7). The AI call itself changes nothing and isn't logged on its own; its answer is stored on the gate's line.
- The real Claude plugs in through the same slot as the stand-in (`askClaude` instead of a fixed form). The Step 6 tests don't call it.
**Left for later:**
- Step 7: a person's reject must be written as a "human decision" line, or it stays in the queue. If the executor refuses a person's approval (R1, R7 or R8), the request has already left the queue, so Step 7 must show that clearly.
- An AI outage uses up the request: it is recorded as "AI down" and sent to a person, and the agent is not asked again on its own.
- A busy database makes the executor throw. A wait time for a busy database is still to do, once the app and the scripts share the file.

## Step 7: Approval screen (2026-10-08)

**Built:** The approval screen at `/approvals`. For each request waiting for a person it shows the customer's message, why a person must decide (in plain words), what the agent said, and the order with what the customer paid, what was already refunded and the most that can still be refunded. A person approves (and can change the amount), or rejects with a required note. When the agent's form named no order, the person picks from the asking customer's own orders. An approval goes to the executor, which pays. `lib/approval.ts` does the work and the screen is a thin layer over it. The logbook's writers now hold a person to R1 and R8 when they decide, and a reject needs a note (`logHumanReject`). Tests: Vitest for the logic, and 13 Playwright tests in a real browser, on their own database file. The three "done when" cases pass: approve; reject without a note is refused; an amount over the limit is refused. Breaking R1 or the note requirement on purpose failed both suites; breaking R8 failed the Vitest suite (the screen never offers someone else's order, so the browser can't try it). An independent review found four real problems, all fixed (below).
**Decided:**
- A person is held to R1 and R8 in the logbook's writer, not just on the screen, so no other route can skip them. The executor still re-checks both at payment.
- A person's reject is a "human decision" line, so the request leaves the queue and can never be paid. A request gets one decision only.
- A comma in an amount only counts as a thousands separator. "1,50" is refused, because it could mean $1.50 or $150, and a payment can't be undone.
- If the executor refuses after a person approves, the approval stays on record, the screen says plainly that NOTHING was paid and why, and it is listed under "Approved but not paid". "Try paying again" only appears when trying again can work (the logbook couldn't write, or an error). A refusal is written down once per reason. Asking to pay something already paid says so and writes nothing.
- The form buttons stay off until the page is ready in the browser, so an early click can't send the typed fields in the address bar. Typed values survive a refused decision.
- The demo (`npm run demo`) uses its own file, `data/demo.db`, and refuses to run on the real database, because it drops that file's logbook. The browser tests use `data/e2e.db`.
- The success banner only claims a payment that is really in the shop's refunds.
**Left for later:**
- There is no sign-in, and the logbook doesn't record who approved or rejected. Anyone who can open the page can decide. (Left open since Step 4. Fine for a one-person portfolio project; adding a required "your name" field is the smallest fix.)
- A wait time for a busy database (`lib/db.ts`) is still not added.
- The browser tests need Chrome installed on the computer (`channel: "chrome"`), and they can't run while `npm run dev` is running in the same folder. Step 10's README should say so.
- `next dev` adds a block of instructions for AI tools to `CLAUDE.md` each time it starts. It was not committed with this step; the owner decides whether to keep it.
- `app/approvals/actions.ts` has no tests of its own; the browser tests cover it.

## Step 8: Practice cases (2026-11-04)

**Built:** 60 practice requests in `data/cases.ts`, each with its right answer: the form a correct agent fills in (action, order, amount, policy line) and what the gate then says. 40 are plain; 20 are tricky: forgotten earlier refunds, an already-refunded order, a missing or wrong order number, someone else's order, a used item, costs beyond the price, a fake instruction inside the message, amounts in words, in euros, or missing, and a request withdrawn in the same message. They reuse the shop data from step 2, so the rule edges (exactly $100, exactly 30 days, a refund exactly 90 days back) are real. `tests/cases.test.ts` feeds every expected form through the real gate and checks the result and rules match, with no AI call.
**Decided:**
- The cases are not in the Inbox. The seed stays identical; the eval runner (step 9) loads them into its own database.
- The right answer is what the policy supports, not what the customer asked for. If a customer asks for $80 but $40 is left, the right answer is $40. An agent that proposes $80 scores a miss, but the gate blocks it, so it is a safe miss.
- No case expects a block. A block means the agent got it wrong; the right answer is always something the shop can act on.
- What is scored: for a refund, the action, order, amount and gate result; for no_refund and unsure, the action and gate result only.
**Left for later:**
- The owner read all 60 on 2026-11-04 and changed none.
- Whether "unsure" should count as half-right on the fake-instruction case (CASE-053) is for step 9 to decide.

## Plan change: Step 11 cut (2026-11-09)

**Decided:** Step 11 (rebuild the full village inside approval-desk) is cut. The village that shows all of the owner's agents is its own project, agent-hub, and approval-desk becomes one house there by sending it a feed. Building the village twice would be wasted work. approval-desk keeps its own approval screen and the village prototype at `/village` from Step 13.
**Left for later:**
- Step 12 says the dashboard opens "from the shop house", which was part of Step 11's village. Settle how the dashboard is reached when Step 12 starts.

## Step 13: Robot-eye Human Desk (2026-11-11)

**Built:** The approval screen at `/approvals` is now the Human Desk in the robot-eye look of the Figma Gate encounter: the village scene with place signs and a mini-map, a console on the right with each waiting request, and a dialogue bar where the desk keeper speaks. Same logic (`lib/approval.ts`); the 13 Step 7 browser tests all pass on the new screen. The village prototype plays inside the app at `/village`. In the village, E or a click on the human desk opens the Human Desk; on the desk, B or "Back to village" goes back. Four new browser tests cover the village playing and the switch both ways, by click and by keyboard.
**Decided:**
- `/village` is the prototype as it is (scripted invented data, view only), with no robot-eye frame around it. The robot-eye look belongs to the Human Desk.
- Typing a "b" into a note or an amount never leaves the desk: the shortcut only works outside form fields. A test checks it.
- The village was drawing one frame and then stopping on an error (a variable in the engine was never declared). Fixed, and the "village plays" test now also fails on any page error.
**Left for later:**
- Nothing links to `/village/gate` (the Gate encounter page) yet.
- Step 5 still waits for the API key.
- `.claude/launch.json` (starts the demo server for previews) is not committed.

## Plan change: robot-eye view removed (2026-11-11)

**Decided:** The robot-eye Human Desk from Step 13 is removed. The first-person view added steps between the owner and a decision without adding anything. `/approvals` is the plain Step 7 screen again (same logic, same tests), and the first-person Gate page at `/village/gate` is gone with its art and styles. The village prototype stays at `/village`, view only. Its human desk now shows a short note like the other places do, instead of leading to `/approvals`: the village plays made-up stories, and the real queue shouldn't look like part of them.
**Kept from Step 13:** the village inside the app, and the fix that stopped it freezing after one frame.
