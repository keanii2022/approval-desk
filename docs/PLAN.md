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

- [ ] **Step 5: Agent** (part 3)
  - **Goal:** Claude reads a request and the shop data and fills the fixed form: action, order, amount, reason, policy line. It cannot change data.
  - **Done when:** five real outputs have been read by the owner; garbled output is blocked (R5).

- [ ] **Step 6: Connect the path**
  - **Goal:** Wire request → agent → form → gate → allowed / human queue / blocked → executor → logbook.
  - **Done when:** a small refund passes; a $150 refund waits for a human; an impossible one is blocked; all three are in the logbook.

- [ ] **Step 7: Approval screen** (part 5)
  - **Goal:** A screen where a human approves, rejects (note required), or changes the amount. If the agent's form named no order (the AI was down or unsure), the human picks the order. R1 applies to the human too.
  - **Done when:** Playwright tests pass for: approve; reject without a note (refused); amount over the limit (refused).

- [ ] **Step 8: Practice cases**
  - **Goal:** 60 practice requests, each with its expected right answer. 20 of them are tricky.
  - **Done when:** all 60 are drafted, and all have been read and corrected by the owner.

- [ ] **Step 9: Eval runner** (part 8)
  - **Goal:** Run every practice case 3 times through the agent and gate, and write a scorecard.
  - **Done when:** the scorecard shows accuracy, misses, and wrong decisions that got through; it is saved with a date.

- [ ] **Step 10: README and demo**
  - **Goal:** Replace every `[PLACEHOLDER]` in the README with real results, and add a demo.
  - **Done when:** a fresh copy runs from the README alone.

- [ ] **Step 11: Village** (added after Step 5; the owner chose to build it early, while step 5 waits for the API key. A working prototype is saved in `prototypes/village/`; this step rebuilds it properly inside the app.)
  - **Goal:** A bird's-eye pixel-art village that shows how the system works, in a calm dusk look (a day palette is optional). The shop is in the middle and opens the dashboard (step 12). One agent house with a logbook outside, and two FOR SALE houses for future agents. The plain-code places are the Inbox stand, the gate, the human desk and the factory. One robot agent carries a request from the Inbox to the gate. The gate light shows green (paid), yellow (a human decides) or red (blocked), and the agent reacts. The human always decides at the desk: nothing is approved on a timer. The factory pays. Clicking the logbook opens the recent entries, each with the agent's reason, the gate's verdict in plain words, and the final outcome. Rules are always shown in plain words, never as rule numbers. It runs slowly by default, with a speed button and a pause key. First version uses the stand-in agent and invented data, so it costs nothing; it connects to live data after step 6. Art is drawn in the project (no game library, nothing copied from any game). View only: nothing in the village can change an order.
  - **Done when:** the three scripted stories (small refund, big refund, blocked refund) play start to finish; the human desk waits for a click; the logbook window opens from the lectern, the panel and the keyboard; every clickable place is reachable by keyboard; Playwright tests cover each of these.

- [ ] **Step 12: Dashboard** (opened from the shop house; builds on steps 7 and 9)
  - **Goal:** One app where the owner can see everything: the shop (customers, orders, refunds), the Inbox, the human queue (reusing the step 7 screen), the logbook, and the dated eval scorecards from step 9. Read-only apart from the step 7 actions. Invented data only.
  - **Done when:** every section loads from the real data; Playwright tests open each section; the latest scorecard is shown with its date.
