import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Windows renderer/browser fixtures share cold filesystem and CPU resources.
    // Enforce the bound here without relying on shell-forwarded CLI arguments.
    // Other platforms keep normal parallelism.
    fileParallelism: process.platform !== "win32",
    // Fresh Chromium, repeated localhost navigation and filesystem cleanup have
    // exceeded five seconds in multiple Windows files (5,002–5,006ms); a passing
    // four-second-readiness fixture took 5,049ms. Use one finite Windows default.
    // Explicit test/suite budgets still override it; production deadlines do not change.
    testTimeout: process.platform === "win32" ? 10_000 : 5_000,
    include: [
      "src/custom-skills/moodle/**/__tests__/**/*.{test,spec}.ts",
      "src/custom-skills/web-layout/__tests__/**/*.{test,spec}.ts",
      "src/custom-skills/interactive-study-guide/**/__tests__/**/*.{test,spec}.ts",
      "src/custom-skills/shared/**/__tests__/**/*.{test,spec}.ts",
      "src/custom-skills/sources/**/__tests__/**/*.{test,spec}.ts",
    ],
    exclude: ["node_modules/**", "t3code-fork/**"],
  },
});
