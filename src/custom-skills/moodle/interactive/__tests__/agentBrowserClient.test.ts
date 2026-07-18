import { describe, expect, it } from "vitest";
import {
  buildAgentBrowserCommandSpec,
  assertNoSensitiveCommandArguments,
  buildCredentialFreeChildEnvironment,
  parseAgentBrowserSnapshot,
  parseAgentBrowserEvalJson,
} from "../agentBrowserClient.js";
import type { MoodleRuntimeConfig } from "../types.js";

describe("agentBrowserClient", () => {
  it("builds npx-backed commands with session and safety options", () => {
    const spec = buildAgentBrowserCommandSpec({
      prompt: "test",
      moodleUrl: "https://moodle.example",
      outputPath: "/tmp/document.typ",
      runDir: "/tmp",
      maxDepth: 0,
      maxPages: 1,
      maxCisPages: 1,
      allowFileDownloads: false,
      baseUrl: "https://moodle.example",
      dashboardUrl: "https://moodle.example/my",
      cisUrls: [],
      cisBaseUrl: "https://cis.example",
      cisDashboardUrl: "https://cis.example",
      username: "secret-user",
      password: "secret-pass",
      headless: true,
      browserSession: "study-buddy-run",
      browserSessionName: "study-buddy-technikum",
      browserAllowedDomains: ["moodle.example", "cis.example"],
      browserActionPolicyPath: "/tmp/policy.json",
      browserMaxOutput: 50000,
    } satisfies MoodleRuntimeConfig);

    expect(spec.command).toBe("npx");
    expect(spec.baseArgs).toContain("agent-browser@0.27.0");
    expect(spec.baseArgs).toContain("study-buddy-run");
    expect(spec.baseArgs).toContain("study-buddy-technikum");
    expect(spec.baseArgs).toContain("moodle.example,cis.example");
    expect(spec.baseArgs).toContain("--content-boundaries");
    expect(spec.sensitiveValues).toEqual(["secret-user", "secret-pass"]);
  });

  it("accepts current snapshot JSON envelopes without a success flag", () => {
    expect(
      parseAgentBrowserSnapshot(
        JSON.stringify({
          _boundary: { origin: "https://moodle.example" },
          data: {
            origin: "https://moodle.example",
            refs: { e1: { role: "link", name: "Course" } },
            snapshot: '- link "Course" [ref=e1, url=https://moodle.example/course]',
          },
        }),
      ),
    ).toMatchObject({
      origin: "https://moodle.example",
      refs: { e1: { name: "Course" } },
    });
  });

  it("parses eval JSON wrapped in content boundaries", () => {
    expect(
      parseAgentBrowserEvalJson(
        [
          "--- AGENT_BROWSER_PAGE_CONTENT nonce=x origin=about:blank ---",
          '"{\\"ok\\":true}"',
          "--- END_AGENT_BROWSER_PAGE_CONTENT nonce=x ---",
        ].join("\n"),
      ),
    ).toEqual({ ok: true });
  });

  it("rejects credentials in any CLI argument before process execution", () => {
    expect(() =>
      assertNoSensitiveCommandArguments(
        ["fill", "#password", "argv-canary-password"],
        ["student", "argv-canary-password"],
      ),
    ).toThrow("expose a credential in argv");
    expect(() =>
      assertNoSensitiveCommandArguments(["open", "https://moodle.example/my/"], ["secret"]),
    ).not.toThrow();
  });

  it("removes credential variables and values from browser child environments", () => {
    expect(
      buildCredentialFreeChildEnvironment(
        {
          PATH: "/safe/bin",
          MOODLE_PASSWORD: "browser-canary",
          CIS_CALENDAR_URL: "https://calendar.example/private",
          HARMLESS_ALIAS: "browser-canary",
          DATABASE_URL: "postgres://user:db-password@database.example/app",
          LANG: "de_AT.UTF-8",
        },
        ["browser-canary"],
      ),
    ).toEqual({ PATH: "/safe/bin", LANG: "de_AT.UTF-8" });
  });
});
