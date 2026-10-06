# Approval Desk

A refund agent for an invented online shop. It can't exceed its limits, sends
big decisions to a human, and its accuracy is measured with evals.

All shop data, customers, and requests are invented.

## Demo

[PLACEHOLDER: screenshot or short clip of a request going through, and the approval screen]

## Results

| Measure | Result |
|---------|--------|
| Agent accuracy (60 cases, 3 runs each) | [PLACEHOLDER] |
| Accuracy on the 20 tricky cases | [PLACEHOLDER] |
| Misses | [PLACEHOLDER] |
| Wrong decisions that got through | [PLACEHOLDER] |
| Bad proposals allowed by the gate (out of 1,000) | [PLACEHOLDER] |
| Safety tests passing | [PLACEHOLDER] |
| Scorecard date | [PLACEHOLDER] |

## How it works

- Flow: request → agent → form → gate → allowed / human queue / blocked → executor → logbook.
- The AI only fills a form. Plain code decides. Only the executor changes orders.
- Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Hard rules

- R1 to R7, summarised here. Full list: [docs/RULES.md](docs/RULES.md)

## Run it yourself

[PLACEHOLDER: setup steps, written and checked in step 10]

## Run the tests

[PLACEHOLDER]

## Run the evals

[PLACEHOLDER]

## Stack

TypeScript, Next.js, SQLite, Vitest, Playwright, Claude API.

## What's next

[docs/ROADMAP.md](docs/ROADMAP.md)
