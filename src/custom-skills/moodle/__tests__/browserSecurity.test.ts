import { describe, expect, it, vi } from "vitest";
import {
  assertNoSensitiveCommandArguments,
  buildCredentialFreeChildEnvironment,
} from "../agentBrowserClient.js";
import type { AgentBrowserClient } from "../agentBrowserClient.js";
import { createBrowserLoginConfig, ensureAgentBrowserLoggedIn } from "../browserAuth.js";

describe("browser credential boundaries", () => {
  it("rejects secrets in argv and strips credentials from child environments", () => {
    expect(() => assertNoSensitiveCommandArguments(
      ["fill", "#password", "argv-canary"],
      ["argv-canary"],
    )).toThrow("credential in argv");
    expect(buildCredentialFreeChildEnvironment({
      PATH: "/safe/bin",
      MOODLE_PASSWORD: "env-canary",
      LANG: "de_AT.UTF-8",
      HARMLESS_ALIAS: "env-canary",
    }, ["env-canary"])).toEqual({ PATH: "/safe/bin", LANG: "de_AT.UTF-8" });
  });

  it("requires secure login URLs and explicit redirect origins", () => {
    expect(() => createBrowserLoginConfig({
      serviceName: "Moodle",
      targetUrl: "http://moodle.example/login",
    })).toThrow("requires HTTPS");
    expect(() => createBrowserLoginConfig({
      serviceName: "Moodle",
      targetUrl: "https://student:secret@moodle.example/login",
    })).toThrow("must not contain credentials");
    expect(createBrowserLoginConfig({
      serviceName: "Moodle",
      targetUrl: "https://moodle.example/login",
      allowedOrigins: ["https://identity.example/sso"],
    }).allowedOrigins).toEqual(["https://moodle.example", "https://identity.example"]);
  });

  it("never sends login credentials through agent-browser fill commands", async () => {
    const fill = vi.fn();
    const client = {
      open: vi.fn(async () => ({ stdout: "", stderr: "" })),
      snapshot: vi.fn(async () => ({
        origin: "https://moodle.example/login",
        refs: {
          user: { role: "textbox", name: "Username" },
          password: { role: "textbox", name: "Password" },
        },
        snapshot: '- textbox "Username"\n- textbox "Password"\n- button "Log in"',
      })),
      getUrl: vi.fn(async () => "https://moodle.example/login"),
      evalText: vi.fn(async () => ""),
      fill,
      click: vi.fn(async () => ({ stdout: "", stderr: "" })),
      press: vi.fn(async () => ({ stdout: "", stderr: "" })),
      wait: vi.fn(async () => ({ stdout: "", stderr: "" })),
      download: vi.fn(async () => ({ stdout: "", stderr: "" })),
      close: vi.fn(async () => ({ stdout: "", stderr: "" })),
    } satisfies AgentBrowserClient;

    await expect(ensureAgentBrowserLoggedIn(client, {
      serviceName: "Moodle",
      targetUrl: "https://moodle.example/login",
      username: "student",
      password: "super-secret",
    })).rejects.toThrow("agent-browser CLI is blocked");
    expect(fill).not.toHaveBeenCalled();
  });
});
