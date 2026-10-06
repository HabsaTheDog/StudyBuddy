import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Windows renderer/browser fixtures share cold filesystem and CPU resources.
    // Enforce the bound here without relying on shell-forwarded CLI arguments.
    // Other platforms keep normal parallelism.
    fileParallelism: process.platform !== "win32",
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
