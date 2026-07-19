import { describe, expect, it } from "vitest";
import { resolveOptionalConcurrency } from "../concurrency.js";

describe("resolveOptionalConcurrency", () => {
  it.each([undefined, "", "0", 0, "unlimited", "off", "disabled", "none"])(
    "treats %p as unthrottled",
    (value) => {
      expect(resolveOptionalConcurrency(value)).toBeNull();
    },
  );

  it("accepts practical parallel limits without forcing a single slot", () => {
    expect(resolveOptionalConcurrency("4")).toBe(4);
    expect(resolveOptionalConcurrency(12)).toBe(12);
  });

  it("bounds invalid or excessive values safely", () => {
    expect(resolveOptionalConcurrency("invalid")).toBeNull();
    expect(resolveOptionalConcurrency(999, 32)).toBe(32);
  });
});
