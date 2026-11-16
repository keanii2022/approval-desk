import { defineConfig } from "@playwright/test";

// Browser tests for the approval screen. They use the Chrome already installed on
// this computer, and their own database file (data/e2e.db), so real data is never touched.
export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  workers: 1, // every test resets the same database file
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3100", channel: "chrome", trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev -- --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 120_000,
    // AGENT_STAND_IN: sent requests get a fixed answer from lib/stand-in-agent.ts, never the real AI.
    env: { APPROVAL_DESK_DB: "data/e2e.db", NEXT_TELEMETRY_DISABLED: "1", AGENT_STAND_IN: "1", TRY_DAILY_LIMIT: "100", TRY_VISITOR_HOURLY_LIMIT: "100" },
  },
});
