# Approval Desk: working rules

A refund agent for an invented online shop. It can't exceed its limits, sends
big decisions to a human, and its accuracy is measured with evals.

## Where things are

- `docs/PLAN.md`: the ten Stage 1 steps, each with a goal and "done when". The first unticked box is the current step.
- `docs/ARCHITECTURE.md`: the parts, the flow, which step builds each part, test standards.
- `docs/RULES.md`: the hard rules (R1 to R8) and open questions.
- `docs/ROADMAP.md`: Stages 2 to 4. Not for now.
- `DECISIONS.md`: one entry per step.
- `private/`: the owner's own notes. Never committed.

## Stack

TypeScript, Next.js, SQLite, Vitest, Playwright, Claude API.
Ask before adding anything outside this list.

## Session rules

1. One step per session. Start by reading `docs/PLAN.md` and finding the first unticked step.
2. Stay inside that step's scope. If something else needs doing, note it; don't do it.
3. A step is done only when its "done when" is true. Show the proof (for example, test output).
4. End every session by:
   - explaining in plain words what was built
   - adding an entry to `DECISIONS.md`
   - ticking the step in `docs/PLAN.md`

## Constraints

- **Public repo.** Invented data only. No real companies, shops, people, employers, or internal material.
- **API key never committed.** It lives only in `.env`. `.env.example` stays without a value.
- **`private/` never committed.** Never copy anything from it into tracked files.
- **Hard rules are fixed.** Never loosen a rule in `docs/RULES.md` to make something pass. Changing one needs the owner's OK and a `DECISIONS.md` entry.
- **Only the executor changes orders.** The agent reads and proposes; it never changes data.
- **The gate is plain code.** No AI inside it.

## Tests

- Gate, executor, logbook, approval screen: ordinary tests that must never fail. They use a stand-in agent and make no AI calls.
- Agent judgment: measured with evals and reported as a score, not pass/fail.
- Tests name the rule they check by its ID, for example "R2: refund over $100 goes to a human".
