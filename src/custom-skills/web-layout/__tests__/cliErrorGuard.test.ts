import { describe, expect, it } from "vitest";
import { isBrokenPipeError } from "../../shared/cliErrorGuard.js";

describe("CLI error guard", () => {
  it("recognizes broken-pipe errors without hiding unrelated failures", () => {
    expect(isBrokenPipeError(Object.assign(new Error("write EPIPE"), { code: "EPIPE" }))).toBe(true);
    expect(isBrokenPipeError(Object.assign(new Error("permission denied"), { code: "EACCES" }))).toBe(false);
    expect(isBrokenPipeError("EPIPE")).toBe(false);
  });
});
