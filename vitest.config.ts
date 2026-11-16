import { configDefaults, defineConfig } from "vitest/config";

// Agent worktrees live under .claude/; their copies of the tests aren't this project's.
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, ".claude/**", "e2e/**"] },
});
