# Approval Desk

A Claude-powered refund agent for a made-up online shop. The AI reads each customer email and suggests what to do. Plain code checks every suggestion against hard limits, and a person decides the big ones. The AI can never move money on its own.

All shop data, customers and messages are invented.

**Try it live: [approval-desk-g3lz.onrender.com](https://approval-desk-g3lz.onrender.com)**. Send the agent a real request and decide the big ones yourself. It's on a free host, so the first visit can take up to a minute to wake up, and the shop resets each time it sleeps. Everyone gets a few tries an hour.

![The village: the robot carries each request from the Inbox past the gate, and big refunds wait at the human desk](docs/demo/village.png)

## Demo

A customer tries to fake an "admin override" for $1,000. The agent ignores it and proposes the real $150. The gate sends it to a person because it's over $100.

![The agent handling a fake admin override](docs/demo/try.png)

A person then approves (and can lower the amount) or rejects with a note. Nobody, the person included, can refund more than was paid. On the live site, that person is you:

![The approval screen](docs/demo/approvals.png)

## Results

Each case is run 3 times. "Got through" means a wrong answer the code checks still let happen.

| Test set | Claude Opus 5.5 | Claude Haiku 5.5 (cheapest) |
|---|---|---|
| 60 practice cases | **98.3%**, 0 got through | 76.1%, 4 got through (all under $100) |
| 60 hard cases, written by a different AI to break it | **95.0%**, 0 got through | 73.3%, 0 got through |

- The code checks let through **0 of 1,000** random bad proposals.
- 272 automated tests and 23 browser tests pass. None of them call the AI.
- Scorecards are dated and saved in [evals/](evals/). The latest is from 2026-11-16.

## How it works

```
customer email → agent (AI) → form → gate (plain code) → paid / sent to a person / blocked
```

- The AI only fills in a form. It can't change any data.
- The gate is plain code, with no AI inside it. It enforces the rules in [docs/RULES.md](docs/RULES.md), like "over $100 goes to a person" and "never more than was paid."
- Every step is written to a logbook before it happens.

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · decisions along the way: [DECISIONS.md](DECISIONS.md)

## Run it yourself

You need Node 24 or newer and a Claude API key.

```bash
git clone https://github.com/keanii2022/approval-desk.git
cd approval-desk
npm install
cp .env.example .env    # then put your key after ANTHROPIC_API_KEY=
npm run seed
npm run dev
```

Open http://localhost:3000 and send the agent a request from the village.

Other commands:

- `npm test` runs the tests (free, no AI).
- `npm run evals` scores the agent on the 60 practice cases. Add `-- --set hard` for the hard set. A full run costs about $4.

## Part of agent-hub

Approval Desk is one house in [agent-hub](https://github.com/keanii2022/agent-hub), a pixel village where each of my AI projects is a house and anything that needs me ends up at my desk.

![agent-hub: approval-desk is one of the houses on the upper street](docs/demo/agent-hub.png)

## Stack

TypeScript, Next.js, SQLite, Vitest, Playwright, Claude API.
