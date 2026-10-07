# Architecture

The AI only suggests. Plain code decides what's allowed. Only one part can
change an order. Every step is written down.

## Parts

| # | Part | What it does | Uses AI? | Changes orders? | Built in step |
|---|------|--------------|----------|-----------------|---------------|
| 1 | Shop data | Invented orders, customers, refund history, policy | No | No | 2 |
| 2 | Inbox | Invented customer requests | No | No | 2 |
| 3 | Agent | Fills a fixed form: action, order, amount, reason, policy line | Yes | No | 5 |
| 4 | Gate | Returns allow / send to human / block, and names the rule | No | No | 3 |
| 5 | Approval screen | Human approves, rejects (note required), or changes the amount; picks the order if the form named none | No | No | 7 |
| 6 | Executor | The only part that changes an order. Accepts only gate-allowed or human-approved proposals | No | **Yes** | 4 |
| 7 | Logbook | Add-only record of every step | No | No (only adds log lines) | 4 |
| 8 | Eval runner | Runs practice cases through parts 3 and 4, writes a scorecard | Calls the agent | No | 9 |

Other steps: 1 sets up the skeleton, 6 connects the parts, 8 writes the
practice cases, 10 writes the README and demo.

## Flow

```
Inbox request
     │
     ▼
   Agent (AI) ──► form: action, order, amount, reason, policy line
     │
     ▼
   Gate (plain code) ── names the rule (R1 to R6)
     │
     ├── allow ─────────────────────────────────► Executor ──► order changed
     │                                               ▲
     ├── send to human ──► Approval screen ── approve / change amount
     │                          │
     │                          └── reject (note required) ──► stop
     │
     └── block ──► stop

Every step above writes to the Logbook first. If it can't write, the step doesn't happen (R7).
```

1. A request arrives from the Inbox.
2. The agent reads it with the shop data and fills the form. It changes nothing.
3. The gate checks the form against the hard rules and returns one result plus the rule ID.
4. Allowed goes to the executor. Send to human goes to the approval screen. Blocked stops.
5. On the approval screen, the human approves, rejects with a note, or changes the amount. If the form named no order, the human picks it. R1 still applies.
6. The executor changes the order, but only for gate-allowed or human-approved proposals. It checks R1 again at that moment.
7. The logbook records every step and is never edited or deleted.

## Test standards

### Never fails

Gate, executor, logbook, approval screen.

- Ordinary tests: Vitest, plus Playwright for the approval screen.
- A stand-in agent returns fixed forms. No AI calls, so the tests are fast, free, and give the same result every time.
- Each test names the rule it checks by ID (see `docs/RULES.md`).

### Measured and reported

Agent judgment.

- 60 practice cases, 20 of them tricky. Each is run 3 times through the agent and gate.
- The scorecard shows:
  - **Accuracy:** how often the result matched the expected answer.
  - **Misses:** cases where it didn't match.
  - **Wrong decisions that got through:** wrong answers the gate still allowed. These are the dangerous ones.
- Each scorecard is saved with a date, so scores can be compared over time.
