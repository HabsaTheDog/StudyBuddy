import { describe, expect, it } from "vitest";
import { createBrowserLoginConfig } from "../browserAuth.js";

describe("interactive browser authentication URL policy", () => {
  it("rejects credentials embedded in a login URL", () => {
    expect(() =>
      createBrowserLoginConfig({
        serviceName: "Moodle",
        targetUrl: "https://student:secret@moodle.example.edu/login",
      }),
    ).toThrow("must not contain credentials");
  });

  it("allows HTTPS and loopback HTTP targets", () => {
    expect(
      createBrowserLoginConfig({
        serviceName: "Moodle",
        targetUrl: "https://moodle.example.edu/login",
      }).allowedOrigins,
    ).toContain("https://moodle.example.edu");
    expect(
      createBrowserLoginConfig({
        serviceName: "Moodle",
        targetUrl: "http://127.0.0.1:3000/login",
      }).allowedOrigins,
    ).toContain("http://127.0.0.1:3000");
  });
});
