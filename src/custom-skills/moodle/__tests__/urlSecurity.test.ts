import { describe, expect, it } from "vitest";
import { assertPublicHttpsUrl, hasExactOrigin, isDisallowedAddress } from "../urlSecurity.js";

describe("URL security", () => {
  it("matches parsed origins rather than string prefixes", () => {
    expect(hasExactOrigin("https://moodle.example/course/1", "https://moodle.example"))
      .toBe(true);
    expect(hasExactOrigin("https://moodle.example.evil.invalid/course/1", "https://moodle.example"))
      .toBe(false);
  });

  it("rejects local, private, reserved, and private-DNS calendar targets", async () => {
    for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "fd00::1"]) {
      expect(isDisallowedAddress(address)).toBe(true);
    }
    await expect(assertPublicHttpsUrl("https://127.0.0.1/calendar.ics"))
      .rejects.toThrow("local or private");
    await expect(assertPublicHttpsUrl("https://calendar.example/feed", async () => ["192.168.1.4"]))
      .rejects.toThrow("local or private");
    await expect(assertPublicHttpsUrl("https://calendar.example/feed", async () => ["1.1.1.1"]))
      .resolves.toBeUndefined();
  });
});
