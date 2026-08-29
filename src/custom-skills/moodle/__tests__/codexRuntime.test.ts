import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CodexRuntimePreflightError,
  preflightCodexRuntime,
  resolveCodexPathOverride,
  resolveCodexProcessInvocation,
} from "../codexRuntime.js";

let tempDir: string | null = null;

afterEach(async () => {
  vi.restoreAllMocks();
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("Codex runtime preflight", () => {
  it("runs bundled JavaScript entrypoints through Node on every platform", () => {
    expect(resolveCodexProcessInvocation("C:\\app\\codex.js", ["--version"]))
      .toEqual({
        command: process.execPath,
        args: ["C:\\app\\codex.js", "--version"],
        envPatch: {},
      });
    expect(resolveCodexProcessInvocation("codex.exe", ["--version"]))
      .toEqual({ command: "codex.exe", args: ["--version"], envPatch: {} });
  });

  it("keeps a packaged Electron executable in Node mode for bundled JavaScript entrypoints", () => {
    expect(resolveCodexProcessInvocation(
      "/app/resources/study-buddy-runtime/node_modules/@openai/codex/bin/codex.js",
      ["--version"],
      { execPath: "/app/study-buddy", electron: true },
    )).toEqual({
      command: "/app/study-buddy",
      args: [
        "/app/resources/study-buddy-runtime/node_modules/@openai/codex/bin/codex.js",
        "--version",
      ],
      envPatch: { ELECTRON_RUN_AS_NODE: "1" },
    });
  });

  it("lets the SDK resolve its packaged native binary instead of executing the JavaScript shim", () => {
    const bundledShim = "/app/resources/study-buddy-runtime/node_modules/@openai/codex/bin/codex.js";
    expect(resolveCodexPathOverride("bundled", bundledShim)).toBeUndefined();
    expect(resolveCodexPathOverride("override", "/opt/codex/bin/codex"))
      .toBe("/opt/codex/bin/codex");
  });

  it("rejects SDK and bundled CLI package skew before executing Codex", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "codex-runtime-"));
    const runProcess = vi.fn();

    await expect(preflightCodexRuntime({
      cacheDir: tempDir,
      models: ["gpt-test"],
      explicitModel: false,
      mode: "version-only",
    }, {
      resolveBundledRuntime: async () => ({
        sdkVersion: "0.145.0",
        bundledCliVersion: "0.144.5",
        bundledCliPath: "/fake/codex",
      }),
      runProcess,
    })).rejects.toThrow("bundles @openai/codex 0.144.5");
    expect(runProcess).not.toHaveBeenCalled();
  });

  it("ignores maintenance and terminal doctor failures when runtime health passes", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "codex-runtime-"));
    const runCanary = vi.fn(async () => undefined);
    const report = await preflightCodexRuntime({
      runDir: tempDir,
      cacheDir: path.join(tempDir, "cache"),
      models: ["gpt-test"],
      explicitModel: false,
    }, healthyDependencies({ runCanary }));

    expect(report.status).toBe("verified");
    expect(report.modelProbes).toEqual([
      expect.objectContaining({ model: "gpt-test", status: "verified" }),
    ]);
    expect(runCanary).toHaveBeenCalledTimes(1);
    expect(runCanary).toHaveBeenCalledWith(
      expect.objectContaining({
        binaryPath: "/fake/codex",
        binarySource: "bundled",
        model: "gpt-test",
      }),
    );
    const persisted = JSON.parse(await readFile(path.join(tempDir, "codex-runtime.json"), "utf8"));
    expect(persisted.effectiveCliVersion).toBe("0.144.5");
  });

  it("treats authentication doctor failures as terminal before model probes", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "codex-runtime-"));
    const runCanary = vi.fn(async () => undefined);

    await expect(preflightCodexRuntime({
      cacheDir: tempDir,
      models: ["gpt-test"],
      explicitModel: false,
    }, healthyDependencies({
      runCanary,
      runProcess: healthyProcessRunner({
        "auth.credentials": { status: "fail", summary: "auth is missing" },
      }),
    }))).rejects.toThrow("auth.credentials: auth is missing");
    expect(runCanary).not.toHaveBeenCalled();
  });

  it("lets the authenticated canary decide after a transient provider HTTP check failure", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "codex-runtime-"));
    const runCanary = vi.fn(async () => undefined);

    const report = await preflightCodexRuntime({
      cacheDir: tempDir,
      models: ["gpt-test"],
      explicitModel: false,
    }, healthyDependencies({
      runCanary,
      runProcess: healthyProcessRunner({
        "auth.credentials": { status: "ok", summary: "auth is configured" },
        "network.provider_reachability": {
          status: "fail",
          summary: "one or more required provider endpoints are unreachable over HTTP",
        },
        "network.websocket_reachability": {
          status: "ok",
          summary: "Responses WebSocket handshake succeeded",
        },
      }),
    }));

    expect(runCanary).toHaveBeenCalledTimes(1);
    expect(report.status).toBe("warning");
    expect(report.modelProbes).toEqual([
      expect.objectContaining({ model: "gpt-test", status: "verified" }),
    ]);
    expect(report.warnings.join(" ")).toContain("transient provider HTTP reachability failure");
  });

  it("reuses doctor and model checks for the same CLI and model", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "codex-runtime-"));
    let now = Date.UTC(2026, 6, 16, 12, 0, 0);
    const runCanary = vi.fn(async () => undefined);
    const runProcess = vi.fn(healthyProcessRunner());
    const dependencies = healthyDependencies({
      now: () => now,
      runCanary,
      runProcess,
    });
    const input = {
      cacheDir: tempDir,
      models: ["gpt-test"],
      explicitModel: false,
    };

    await preflightCodexRuntime(input, dependencies);
    now += 60_000;
    const second = await preflightCodexRuntime(input, dependencies);

    expect(second.modelProbes[0]?.status).toBe("cached");
    expect(runCanary).toHaveBeenCalledTimes(1);
    expect(runProcess.mock.calls.filter(([, args]) => args[0] === "doctor")).toHaveLength(1);
  });

  it("bypasses existing cache entries when explicitly requested", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "codex-runtime-"));
    const runCanary = vi.fn(async () => undefined);
    const runProcess = vi.fn(healthyProcessRunner());
    const dependencies = healthyDependencies({ runCanary, runProcess });
    const input = {
      cacheDir: tempDir,
      models: ["gpt-test"],
      explicitModel: false,
    };

    await preflightCodexRuntime(input, dependencies);
    await preflightCodexRuntime({ ...input, bypassCache: true }, dependencies);

    expect(runCanary).toHaveBeenCalledTimes(2);
    expect(runProcess.mock.calls.filter(([, args]) => args[0] === "doctor")).toHaveLength(2);
  });

  it("uses one configured fallback only for policy-selected models", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "codex-runtime-"));
    const runCanary = vi.fn(async ({ model }: { model: string }) => {
      if (model === "gpt-new") throw new Error("requires a newer version of Codex");
    });
    const report = await preflightCodexRuntime({
      cacheDir: tempDir,
      models: ["gpt-new"],
      explicitModel: false,
      fallbackModel: "gpt-compatible",
    }, healthyDependencies({ runCanary }));

    expect(report.fallbackApplied).toBe("gpt-compatible");
    expect(report.effectiveModels).toEqual(["gpt-compatible"]);
  });

  it("never replaces an explicitly selected model", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "codex-runtime-"));
    const runCanary = vi.fn(async () => {
      throw new Error("requires a newer version of Codex");
    });

    await expect(preflightCodexRuntime({
      cacheDir: tempDir,
      models: ["gpt-explicit"],
      explicitModel: true,
      fallbackModel: "gpt-compatible",
    }, healthyDependencies({ runCanary }))).rejects.toBeInstanceOf(CodexRuntimePreflightError);
    expect(runCanary).toHaveBeenCalledTimes(1);
  });

  it("lets bounded model-call recovery handle a transient canary timeout", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "codex-runtime-"));
    const runCanary = vi.fn(async () => {
      throw new Error("The operation was aborted");
    });

    const report = await preflightCodexRuntime({
      cacheDir: tempDir,
      models: ["gpt-policy"],
      explicitModel: false,
      fallbackModel: "gpt-compatible",
    }, healthyDependencies({ runCanary }));

    expect(report.status).toBe("warning");
    expect(report.fallbackApplied).toBeNull();
    expect(report.effectiveModels).toEqual(["gpt-policy"]);
    expect(report.warnings.join(" ")).toContain("inconclusive");
    expect(report.modelProbes).toEqual([
      expect.objectContaining({ model: "gpt-policy", status: "failed" }),
    ]);
  });
});

function healthyDependencies(overrides: Record<string, unknown> = {}) {
  return {
    resolveBundledRuntime: async () => ({
      sdkVersion: "0.144.5",
      bundledCliVersion: "0.144.5",
      bundledCliPath: "/fake/codex",
    }),
    runProcess: healthyProcessRunner(),
    fetchLatestVersion: async () => "0.144.5",
    runCanary: async () => undefined,
    ...overrides,
  };
}

function healthyProcessRunner(doctorChecks: Record<string, unknown> = {
  "auth.credentials": { status: "ok", summary: "auth is configured" },
  "runtime.provenance": { status: "ok", summary: "runtime is healthy" },
  installation: { status: "fail", summary: "update targets a different install" },
  "terminal.env": { status: "fail", summary: "TERM=dumb" },
}) {
  return async (command: string, args: string[]) => {
    if (args[0] === "--version") {
      return { exitCode: 0, stdout: "codex-cli 0.144.5\n", stderr: "" };
    }
    if (args[0] === "doctor") {
      return {
        exitCode: 1,
        stdout: JSON.stringify({ schemaVersion: 1, overallStatus: "fail", checks: doctorChecks }),
        stderr: "",
      };
    }
    if (command === "codex") {
      return { exitCode: 0, stdout: "codex-cli 0.144.5\n", stderr: "" };
    }
    throw new Error(`Unexpected process: ${command} ${args.join(" ")}`);
  };
}
