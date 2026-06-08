import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/custom-skills/moodle/__tests__/**/*.{test,spec}.ts"],
    exclude: ["node_modules/**", "t3code-fork/**"],
  },
});
