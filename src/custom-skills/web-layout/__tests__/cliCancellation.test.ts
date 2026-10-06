import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("web-layout CLI cancellation", () => {
  it.skipIf(process.platform === "win32")("aborts an active native request and releases the run on SIGTERM", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "web-cli-cancel-"));
    let entered!: () => void;
    let closed!: () => void;
    const requested = new Promise<void>((resolve) => { entered = resolve; });
    const disconnected = new Promise<void>((resolve) => { closed = resolve; });
    let calls = 0;
    const server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        if (JSON.parse(body).context) {
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ turnId: "active", originalUserPrompt: "Original request: α\nCreate a simple worksheet", images: [] }));
          return;
        }
        calls++;
        response.on("close", closed);
        entered();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const child = spawn(process.execPath, ["--import", "tsx", path.resolve("src/custom-skills/web-layout/cli.ts"),
      "Create a simple worksheet", "--kind", "worksheet", "--language", "en", "--run-dir", runDir,
    ], { stdio: "ignore", env: {
      ...process.env, WEB_LAYOUT_TEST_CODEX: "0",
      STUDY_BUDDY_MODEL_BRIDGE_URL: `http://127.0.0.1:${port}/api/study-buddy/model`,
      STUDY_BUDDY_MODEL_BRIDGE_TOKEN: "test-only", STUDY_BUDDY_MODEL_BRIDGE_PROVIDER: "antigravity",
      STUDY_BUDDY_MODEL_BRIDGE_MODEL: "fixture", STUDY_BUDDY_MODEL_BRIDGE_THREAD: "fixture",
    } });
    const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
    try {
      await requested;
      child.kill("SIGTERM");
      expect(await exited).toBe(1);
      await disconnected;
      expect(calls).toBe(1);
      const config = JSON.parse(await readFile(path.join(runDir, "config.json"), "utf8"));
      expect(config.prompt).toBe("Original request: α\nCreate a simple worksheet");
      expect(config.originalUserPrompt).toBe(config.prompt);
      expect(await readFile(path.join(runDir, "run-summary.md"), "utf8")).toContain("SIGTERM");
      await expect(readFile(path.join(runDir, ".study-buddy-active-run.json"))).rejects.toThrow();
    } finally {
      child.kill("SIGKILL");
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(runDir, { recursive: true, force: true });
    }
  }, 15_000);
});
