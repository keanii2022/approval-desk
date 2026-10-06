# Stage 1 plan

One step per session. Tick a box only when its "done when" is true.
Part numbers match `docs/ARCHITECTURE.md`. Rule IDs match `docs/RULES.md`.

- [x] **Step 1: Skeleton**
  - **Goal:** Start the project: git, Next.js with TypeScript, Vitest, one sample test. Nothing else.
  - **Done when:** the test passes; `.env` and `private/` are excluded from uploads.

- [x] **Step 2: Shop data, Inbox, and policy** (parts 1 and 2)
  - **Goal:** Invented orders, customers, refund history, and a written refund policy, plus invented customer requests (the Inbox), loaded into SQLite by a seed script. Include examples that hit each rule and the edge cases. Settle open questions Q1 to Q3 in `docs/RULES.md`.
  - **Done when:** running the seed script twice gives identical data (shop data and Inbox); every hard rule (R1 to R7) appears in the policy.

- [ ] **Step 3: Gate** (part 4)
  - **Goal:** Plain code, no AI. Takes a filled form and the shop data, returns allow / send to human / block, and names the rule ID. Settle open questions Q4 and Q5.
  - **Done when:** one test per rule the gate checks (R1 to R6; R7 is tested in step 4); 1,000 bad proposals are fed in and none is allowed.

- [ ] **Step 4: Executor and logbook** (parts 6 and 7)
  - **Goal:** The executor, the only part that changes an order, accepting only gate-allowed or human-approved proposals. The logbook, add-only.
  - **Done when:** a proposal that skipped the gate is refused; a broken log means no refund (R7).

- [ ] **Step 5: Agent** (part 3)
  - **Goal:** Claude reads a request and the shop data and fills the fixed form: action, amount, reason, policy line. It cannot change data.
  - **Done when:** five real outputs have been read by the owner; garbled output is blocked (R5).

- [ ] **Step 6: Connect the path**
  - **Goal:** Wire request → agent → form → gate → allowed / human queue / blocked → executor → logbook.
  - **Done when:** a small refund passes; a $150 refund waits for a human; an impossible one is blocked; all three are in the logbook.

- [ ] **Step 7: Approval screen** (part 5)
  - **Goal:** A screen where a human approves, rejects (note required), or changes the amount. R1 applies to the human too.
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
