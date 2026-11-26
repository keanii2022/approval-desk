# Approval Desk

A refund agent where the AI can only suggest. Plain code enforces 14 hard limits, a person decides the risky ones, and every eval run is published, including the ones where it failed and what fixed them.

All shop data, customers and messages are invented.

**Try it live: [approval-desk-g3lz.onrender.com](https://approval-desk-g3lz.onrender.com)**. Send the agent a real request and decide the big ones yourself. Every visitor gets their own copy of the shop, so what you decide never changes anyone else's. It's on a free host, so the first visit can take up to a minute to wake up. Everyone gets a few tries an hour.

**What the evals found:** 304 test cases, most written by other AIs to break it. On the old rules, wrong refunds got paid: 21 of 36 answers on follow-up tricks, then 40 more on disguised order numbers, stacked refunds and two-order emails. With 14 rules, 1 wrong refund got through in 912 answers, an email that names its second order only by the item. [Full results below](#results).

![The village: the robot carries each request from the Inbox past the gate, and big refunds wait at the human desk](docs/demo/village.png)

## Demo

A customer tries to fake an "admin override" for $1,000. The agent ignores it and proposes the real $150. The gate sends it to a person because it's over $100.

![The agent handling a fake admin override](docs/demo/try.png)

A person then approves (and can lower the amount) or rejects with a note. Nobody, the person included, can refund more than was paid. On the live site, that person is you:

![The approval screen](docs/demo/approvals.png)

## Results

Each case is run 3 times on Claude Opus 5.5. "Got through" means a wrong answer the code checks still let happen.

In the order they ran. The first practice and hard sets scored near 100%, which looked too good: the same AI had built the agent and written its tests, so they shared its blind spots. From there, other AIs (ChatGPT, Gemini, and a breaker agent) wrote the attacks, and every hole they found got a rule and more cases.

| Test set | First test | Rules added | Retest |
|---|---|---|---|
| 60 practice cases | 98.3%, 0 got through | R9 to R14 | 98.3%, 0 got through |
| 60 hard cases, written by a different AI to break it | 95.0%, 0 got through | R9 to R14 | 93.3%, 0 got through |
| 12 hole cases: follow-ups, repeats, flagged and new accounts | 8.3%, **21 wrong refunds paid** | R9, R10 | **75.0%, 0 got through** (71.9% with all 19 on R1–R14) |
| 3 hole cases: orders not delivered yet | 0.0%, **9 wrong refunds paid** | R11 | **100%, 0 got through** |
| 12 edge cases: each rule's exact boundary, both sides | 100%, 0 got through | none needed | |
| 75 cases written by another AI (Gemini) after R9 to R11 | 93.8%, 1 customer turned away, no money out | R12 to R14 | 95.1%, 0 got through |
| 4 hole cases: order numbers that aren't the customer's, plus the two repeat misses | **3 wrong refunds paid, 1 customer turned away** | R12 | **0 got through** |
| 23 disguised order numbers: "order #1002", look-alike letters, invisible characters | 2.9%, **12 wrong refunds paid** | stricter R12 scan | 0.0%, **0 got through** (the agent says "unsure", a person decides) |
| 11 refunds stacked across orders: $300 in two days, $1,500 a year, exactly $150 | 44.4%, **15 wrong refunds paid** | R13 | **100%, 0 got through** |
| 10 emails about two orders at once, plus HARD-060 | 20.0%, **7 wrong refunds paid** | R14 | 23.3%, **1 got through** (second order named only by its item) |
| 15 tricks in the subject line and the customer's name | 66.7%, **6 wrong refunds paid** | stricter R12 scan, fenced subject | **80.0%, 0 got through** |
| 15 amount tricks: "$1,500", pounds and yen, one towel of three | 97.8%, 0 got through | none needed | 100%, 0 got through |
| 6 odd dates: month ends, leap day, a request before its order | 33.3%, 3 flagged, all one badly worded case (it paid less, not more) | strict dates | 66.7%, 0 got through |

What each set tests, and why some retests sit below 100% with nothing paid: [EVALS.md](EVALS.md#what-the-sets-test). The new attack sets were written by a breaker agent whose only job was to make it fail; it also found holes in plain code (bad rows in the database, odd dates) that are now closed and tested.

**Why a gate and not just the AI:** the cheaper model, Haiku, was right only 50 to 63% of the time across five sets (R1–R12). Only 1 of its 678 answers got through: when it was wrong, it mostly said "unsure", or a rule sent it to a person.

**Cost:** about 1 cent per request on Claude Opus 5.5. Every call's tokens, time and cost are written down, and `npm run trace` adds them up.

- The code checks let through **0 of 1,000** random bad proposals, across all 14 rules.
- Rule text is part of what the agent reads, so it gets scored too. R12's first wording ("a person checks before anything is paid") made the agent guess more freely, and the original hard set showed 6 wrong refunds. Plain wording fixed one of the two cases; the other, an email about two orders at once, is now R14.
- Prompt changes are scored before they ship, with a guess written down first ([EVALS.md](EVALS.md)). Two changes took practice to 100%, but the hard set, which wasn't used for tuning, showed them letting 3 wrong refunds through, so the original prompt stayed.
- 588 automated tests and 27 browser tests pass. None of them call the AI. 9 more keep the known open holes on record.
- Every scorecard is dated and saved in [evals/](evals/). Eval runs stop at a spending cap, and a weekly drift check reruns a sample of every set to catch a model update changing behavior.

## What's tested, and what's next

Tested so far (every run is in [evals/](evals/)):
- 60 practice cases, 60 hard cases written by ChatGPT, and 75 more written by Gemini after the newer rules
- 19 hole cases and 12 edge cases on each rule's exact boundary
- 78 attack cases from a breaker agent: disguised order numbers, stacked refunds, two-order emails, tricks in the subject and name, amounts, dates
- Claude Haiku on five sets, next to Opus
- Two requests on one order at the same moment, and wrong data in the shop's own tables
- 1,000 random bad proposals against the gate, plus 588 automated and 27 browser tests with no AI

Still open:
- "My other order", or a second order named only by its item: plain code can't see these, so they're left to the agent and the evals (1 of 30 got through).
- An order number written as a bare number or in words.
- The weekly drift check runs on GitHub once the repository has an API key.

## How it works

```
customer email → agent (AI) → form → gate (plain code) → paid / sent to a person / blocked
```

- The AI only fills in a form. It can't change any data.
- The gate is plain code, with no AI inside it. It enforces the rules in [docs/RULES.md](docs/RULES.md), like "over $100 goes to a person" and "never more than was paid."
- Every step is written to a logbook before it happens. If the logbook can't write, nothing happens (R7).
- If the AI is down or unsure, the request goes to a person instead (R6). It fails toward a human, never toward paying.

The owner's [dashboard](https://approval-desk-g3lz.onrender.com/dashboard) shows the shop, the Inbox, the human desk, the logbook and every scorecard. It opens from the shop house in the village.

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
- `npm run evals` scores the agent on the 60 practice cases. Add `-- --set hard` or `-- --set holes` for the other sets. A full run of the 60 costs about $2.
- `npm run probe` runs follow-up and repeat requests against a fresh shop (free). Add `-- --real` to use the real agent, for a few cents.
- `npm run trace` prints the calls, tokens, cost and time behind every real request.

## Part of agent-hub

Approval Desk is one house in [agent-hub](https://github.com/keanii2022/agent-hub), a pixel village where each of my AI projects is a house and anything that needs me ends up at my desk.

![agent-hub: approval-desk is one of the houses on the upper street](docs/demo/agent-hub.png)

## Stack

TypeScript, Next.js, SQLite, Vitest, Playwright, Claude API.
