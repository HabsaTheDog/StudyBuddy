import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkpointOperation } from "../operationCheckpoint.js";
const directories: string[] = [];
const directory = async () => {
  const value = await mkdtemp(path.join(os.tmpdir(), "operation-checkpoint-"));
  directories.push(value);
  return value;
};
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((value) => rm(value, { recursive: true, force: true })),
  );
});
const validate = (value: unknown) => {
  if (typeof value !== "string" || value !== "valid") throw new Error("invalid structured result");
  return value;
};
describe("durable operation ownership", () => {
  it("persists successes and propagates them through multiple resumes without calls", async () => {
    const first = await directory();
    const second = await directory();
    const third = await directory();
    const run = vi.fn(async () => "valid");
    const common = {
      key: "chapter:observed-id",
      binding: { evidence: "frozen", request: "original" },
      policy: "same-models",
      validate,
      run,
    };
    await checkpointOperation({ ...common, runDir: first });
    await checkpointOperation({ ...common, runDir: second, resumeRunDir: first });
    await checkpointOperation({ ...common, runDir: third, resumeRunDir: second });
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("does not reset exhausted attempts on nested retries, resume or model changes", async () => {
    const runDir = await directory();
    const resume = await directory();
    const run = vi.fn(async () => "invalid");
    const common = { key: "chapter:one", binding: "same evidence", policy: "first", validate, run };
    await expect(checkpointOperation({ ...common, runDir })).rejects.toThrow(
      "three persisted attempts",
    );
    await expect(
      checkpointOperation({ ...common, runDir: resume, resumeRunDir: runDir, policy: "second" }),
    ).rejects.toThrow("three persisted attempts");
    expect(run.mock.calls).toHaveLength(3);
  });
  it("validates the third result and serializes duplicate work for the same key", async () => {
    const runDir = await directory();
    const run = vi
      .fn()
      .mockResolvedValueOnce("invalid")
      .mockResolvedValueOnce("invalid")
      .mockResolvedValue("valid");
    const input = { runDir, key: "same", binding: "evidence", policy: "policy", validate, run };
    expect(await Promise.all([checkpointOperation(input), checkpointOperation(input)])).toEqual([
      "valid",
      "valid",
    ]);
    expect(run).toHaveBeenCalledTimes(3);
  });
  it("rejects tampered approved values and pre-dispatch cancellation", async () => {
    const runDir = await directory();
    const run = vi.fn(async () => "valid");
    const input = { runDir, key: "same", binding: "evidence", policy: "policy", validate, run };
    await checkpointOperation(input);
    const files = await readdir(path.join(runDir, "operation-checkpoints"));
    const file = path.join(runDir, "operation-checkpoints", files[0]!);
    const record = JSON.parse(await readFile(file, "utf8"));
    record.value = "changed";
    await writeFile(file, JSON.stringify(record));
    await expect(checkpointOperation(input)).rejects.toThrow("content hash mismatch");
    await expect(
      checkpointOperation({ ...input, key: "other", signal: AbortSignal.abort() }),
    ).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
