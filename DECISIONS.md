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
