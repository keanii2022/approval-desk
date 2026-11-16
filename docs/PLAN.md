# Stage 1 plan

One step per session. Tick a box only when its "done when" is true.
Part numbers match `docs/ARCHITECTURE.md`. Rule IDs match `docs/RULES.md`.

- [x] **Step 1: Skeleton**
  - **Goal:** Start the project: git, Next.js with TypeScript, Vitest, one sample test. Nothing else.
  - **Done when:** the test passes; `.env` and `private/` are excluded from uploads.

- [x] **Step 2: Shop data, Inbox, and policy** (parts 1 and 2)
  - **Goal:** Invented orders, customers, refund history, and a written refund policy, plus invented customer requests (the Inbox), loaded into SQLite by a seed script. Include examples that hit each rule and the edge cases. Settle open questions Q1 to Q3 in `docs/RULES.md`.
  - **Done when:** running the seed script twice gives identical data (shop data and Inbox); every hard rule (R1 to R7) appears in the policy.

- [x] **Step 3: Gate** (part 4)
  - **Goal:** Plain code, no AI. Takes a filled form and the shop data, returns allow / send to human / block, and names the rule ID. Settle open questions Q4 and Q5.
  - **Done when:** one test per rule the gate checks (R1 to R6; R7 is tested in step 4); 1,000 bad proposals are fed in and none is allowed.

- [x] **Step 4: Executor and logbook** (parts 6 and 7)
  - **Goal:** The executor, the only part that changes an order, accepting only gate-allowed or human-approved proposals. The logbook, add-only.
  - **Done when:** a proposal that skipped the gate is refused; a broken log means no refund (R7).

- [x] **Step 5: Agent** (part 3)
  - **Goal:** Claude reads a request and the shop data and fills the fixed form: action, order, amount, reason, policy line. It cannot change data.
  - **Done when:** five real outputs have been read by the owner; garbled output is blocked (R5).

- [x] **Step 6: Connect the path**
  - **Goal:** Wire request → agent → form → gate → allowed / human queue / blocked → executor → logbook.
  - **Done when:** a small refund passes; a $150 refund waits for a human; an impossible one is blocked; all three are in the logbook.

- [x] **Step 7: Approval screen** (part 5)
  - **Goal:** A screen where a human approves, rejects (note required), or changes the amount. If the agent's form named no order (the AI was down or unsure), the human picks the order, from the asking customer's own orders only. R1 and R8 apply to the human too.
  - **Done when:** Playwright tests pass for: approve; reject without a note (refused); amount over the limit (refused).

- [x] **Step 8: Practice cases**
  - **Goal:** 60 practice requests, each with its expected right answer. 20 of them are tricky.
  - **Done when:** all 60 are drafted, and all have been read and corrected by the owner.

- [x] **Step 9: Eval runner** (part 8)
  - **Goal:** Run every practice case 3 times through the agent and gate, and write a scorecard.
  - **Done when:** the scorecard shows accuracy, misses, and wrong decisions that got through; it is saved with a date.

- [x] **Step 10: README and demo**
  - **Goal:** Replace every `[PLACEHOLDER]` in the README with real results, and add a demo.
  - **Done when:** a fresh copy runs from the README alone.

- [-] **Step 11: Village** (CUT on 2026-11-09: the full village now lives in the agent-hub project, where approval-desk is one house. The prototype stays at `/village` from Step 13. See `DECISIONS.md`.) (added after Step 5; the owner chose to build it early, while step 5 waits for the API key. A working prototype is saved in `prototypes/village/`; this step rebuilds it properly inside the app.)
  - **Goal:** A bird's-eye pixel-art village that shows how the system works, in a calm dusk look (a day palette is optional). The shop is in the middle and opens the dashboard (step 12). One agent house with a logbook outside, and two FOR SALE houses for future agents. The plain-code places are the Inbox stand, the gate, the human desk and the factory. One robot agent carries a request from the Inbox to the gate. The gate light shows green (paid), yellow (a human decides) or red (blocked), and the agent reacts. The human always decides at the desk: nothing is approved on a timer. The factory pays. Clicking the logbook opens the recent entries, each with the agent's reason, the gate's verdict in plain words, and the final outcome. Rules are always shown in plain words, never as rule numbers. It runs slowly by default, with a speed button and a pause key. First version uses the stand-in agent and invented data, so it costs nothing; it connects to live data after step 6. Art is drawn in the project (no game library, nothing copied from any game). View only: nothing in the village can change an order.
  - **Done when:** the three scripted stories (small refund, big refund, blocked refund) play start to finish; the human desk waits for a click; the logbook window opens from the lectern, the panel and the keyboard; every clickable place is reachable by keyboard; Playwright tests cover each of these.

- [-] **Step 13: Robot-eye Human Desk** (REMOVED on 2026-11-11: the owner found the first-person view added steps without a purpose. `/approvals` is the plain Step 7 screen again; the village stays at `/village`, view only, with no door to the desk. See `DECISIONS.md`.) (added after Step 7. The owner designed a first-person "robot-eye" view of the village in Figma, the Gate encounter, and chose to build the Human Desk in that look next, before Step 11 rebuilds the whole village.)
  - **Goal:** The approval screen becomes a first-person stop in the village, in the look of the Figma Gate encounter: the village scene with place signs and a mini-map, a console on the right that shows each waiting request (the message, why a person must decide, what the agent said, the order with what was paid and what is left), and a dialogue bar at the bottom where the Human Desk speaks and the person decides. Same rules, same logic (`lib/approval.ts`), same tests. The village prototype runs inside the app at `/village` (ported as it is: scripted invented data, view only), and a person can switch between the two: at the human desk in the village, enter the robot-eye view; from the robot-eye view, go back to the village. Both by click and by keyboard.
  - **Done when:** the Step 7 browser tests still pass on the new screen; browser tests cover the switch both ways, by click and by keyboard; the village plays inside the app at `/village`.

- [ ] **Step 12: Dashboard** (opened from the shop house; builds on steps 7 and 9)
  - **Goal:** One app where the owner can see everything: the shop (customers, orders, refunds), the Inbox, the human queue (reusing the step 7 screen), the logbook, and the dated eval scorecards from step 9. Read-only apart from the step 7 actions. Invented data only.
  - **Done when:** every section loads from the real data; Playwright tests open each section; the latest scorecard is shown with its date.

- [ ] **Step 14: Prompt scores** (builds on step 9)
  - **Goal:** Change the agent's prompt twice, each time writing down a guess of what will change before running the evals. Record all three scores (baseline and two changes) in `EVALS.md`, with the guess next to each result.
  - **Done when:** `EVALS.md` holds three dated scorecards with a written guess for each prompt change; a test fails if the prompt file changed but `EVALS.md` did not.

- [ ] **Step 15: Tracing** (builds on step 5)
  - **Goal:** Every Claude call logs tokens in and out, cost, latency and the gate's result, on the gate's logbook line. One command prints a summary: calls, total cost, average latency, results by gate verdict.
  - **Done when:** the summary command runs on the seeded database and matches the logbook by hand for five calls; a test checks the line is written on success and on an AI outage.

- [ ] **Step 16: Live on the internet** (moved below, into "Public village", on 2026-11-16: it now comes before step 15, and the cost table waits for step 15.)

## Public village (added 2026-11-16)

The owner chose to make the village the front door and go live before steps 12, 14 and 15. Visitors try the real agent on the owner's credits, behind hard spending limits. See `DECISIONS.md`.

### 17. Visitors and spending guards
- **Status:** done
- **Goal:** Every visitor gets a private sandbox: a cookie holds a random visitor ID, and the try page and the approval screen only show that visitor's own tried requests (seeded `REQ-` requests still show, so local demos keep working). A visitor can only approve or reject their own tried requests. Spending locks on the real agent: at most `TRY_DAILY_LIMIT` tries a day across everyone (default 50), and at most `TRY_VISITOR_HOURLY_LIMIT` per visitor per hour (default 5). Over a limit, the try is refused in plain words before any AI call ("The agent is done for today, come back tomorrow"), and nothing is written.
- **Scope:** `lib/tryout.ts`, `lib/visitor.ts` (new), `lib/approval.ts`, `app/try/actions.ts`, `app/try/page.tsx`, `app/approvals/page.tsx`, `app/approvals/actions.ts`, `tests/tryout.test.ts`, `tests/approval.test.ts`
- **Out of scope:** the village, `app/try/TryForm.tsx` layout, the gate, the executor, the seed schema.
- **Dependencies:** none
- **Done when:** tests show a fresh visitor sees no tried requests, one visitor can't see or decide another's, both limits refuse before the agent is called, and the existing approval tests still pass.

### 18. Ready to host
- **Status:** done
- **Goal:** The app runs on a host from `npm start` alone: if the database file at `APPROVAL_DESK_DB` (or the default path) doesn't exist, it is seeded first, then `next start` runs on the host's `PORT`. `package.json` says Node 24 or newer. `.env.example` lists the new optional settings (`AGENT_MODEL`, `TRY_DAILY_LIMIT`, `TRY_VISITOR_HOURLY_LIMIT`, `APPROVAL_DESK_DB`) without values.
- **Scope:** `package.json`, `scripts/start.ts` (new), `.env.example`
- **Out of scope:** app code, the README.
- **Dependencies:** none
- **Done when:** with no database file, `npm run build && npm start` seeds it and serves `/` on the given `PORT`; with a file present, it isn't re-seeded.

### 19. Village front door
- **Status:** done
- **Goal:** The village is the front page (`/`). It plays the scripted demo stories on its own, as now. Clicking the Inbox stand (or pressing its key) opens a panel over the village with the try form (customer picker, receipt, example buttons). After sending, the panel shows the result (what the agent filled in, what the gate decided, how it ended). Clicking the human desk opens the visitor's own waiting requests, with a way to the approval screen. The page says in one line what this is and links to GitHub. A short note makes clear the scripted stories are made up and "your requests" are real. Original pixel art only, nothing copied from any game.
- **Scope:** `app/page.tsx`, `app/village/*`, `e2e/village.e2e.ts`, small changes to `app/try/TryForm.tsx` and `app/try/actions.ts` so the form can work inside the panel without leaving the village
- **Out of scope:** `lib/*`, the approval screen's logic, the try page's logic (reuse `TryForm` and `tryAction` as they are).
- **Dependencies:** 17
- **Done when:** browser tests open the try panel from the Inbox by click and by keyboard, send a request (stand-in agent) and see the result in the panel, and the village still plays the three scripted stories.

### 20. The village plays your request
- **Status:** current
- **Goal:** After a visitor sends a request from the Inbox panel, the robot carries it through the village: Inbox to the agent house to the gate, and the gate light shows the real gate's decision (green paid, yellow a person decides, red blocked). On yellow, the human desk lights up and waits for the visitor. On green, the factory pays. The logbook gets the visitor's real entry. The scripted stories pause while the visitor's request plays.
- **Scope:** `app/village/*`, `e2e/village.e2e.ts`, a test-only stand-in agent (`lib/stand-in-agent.ts`, new) picked in `app/try/actions.ts` when `AGENT_STAND_IN=1`, and that setting in `playwright.config.ts`
- **Out of scope:** `lib/*`, the approval screen.
- **Dependencies:** 19
- **Done when:** browser tests (stand-in agent) send a small refund, a big refund and a garbled one, and see the green, yellow and red lights in turn, with the visitor's entry in the logbook.

### 16. Live on the internet
- **Status:** todo
- **Goal:** The app runs on Render's free plan (chosen 2026-11-16: $0 a month; it sleeps when idle and wakes with a fresh copy of the data), invented data only, the owner's key on the host only, spending limits on. The README opens with the live link, says this agent is one house in the owner's bigger agent-hub, with a screenshot of the hub supplied by the owner. The cost table from step 15 is added once step 15 is done.
- **Scope:** `README.md`, host settings (owner's account)
- **Out of scope:** app code.
- **Dependencies:** 17, 18, 19, 20
- **Done when:** a stranger can open the URL, send a request from the village and approve it.

## Calls to review

- **17:** Hourly limit message: "That's all your tries for this hour. Come back in a bit." Matches the plain tone of the daily one.
- **17:** The visitor cookie is called `visitor` and lasts a year (httpOnly, secure in production), so a returning visitor keeps their sandbox.
- **17:** Someone else's try answers "That request could not be found", so it doesn't reveal that the request exists.
- **17:** The daily limit resets at midnight UTC, the same clock as the logbook.
- **17:** Tries made before step 17 have no owner, so they no longer show to anyone. Only local test data was affected.
- **18:** `npm start` checks for the database file, seeds it if missing, then runs `next start`, which reads the host's PORT itself. It prints one line saying which happened, so host logs show it.
- **18:** `.env.example` didn't get the 4 optional settings: this session isn't allowed to read or edit it. The owner can add `AGENT_MODEL`, `TRY_DAILY_LIMIT`, `TRY_VISITOR_HOURLY_LIMIT`, `APPROVAL_DESK_DB`, empty, with a comment each.
- **19:** Keys: I opens the Inbox, H the human desk, Escape closes. "P AUTO" left the key strip to make room; the auto-play button still shows its state.
- **19:** `/village` now sends people to `/`.
- **19:** Top line: "APPROVAL DESK" plus one sentence on what it is and a GitHub link. A note under the scene says the stories are made up and your requests are real.
- **19:** Panel titles "The Inbox", "What happened", "The human desk". The village keeps playing, dimmed, behind the panel.
- **19:** The human desk shows only your own tried requests; the seeded practice ones stay on the approval screen.
- **Locks (owner asked for extra):** daily cap default lowered to 20, `TRY_ENABLED=off` switches the live agent off, and one Claude call is capped at 4,000 output tokens (a cut-off answer is blocked, R5). Re-seeding also clears the try owners, which fixed a crash after resetting the Inbox.
