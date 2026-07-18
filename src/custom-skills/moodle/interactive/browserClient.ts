import { createAgentBrowserClient, type AgentBrowserClient } from "./agentBrowserClient.js";
import { createPlaywrightBrowserClient } from "./playwrightBrowserClient.js";
import type { MoodleRuntimeConfig } from "./types.js";

export function createBrowserClient(config: MoodleRuntimeConfig): AgentBrowserClient {
  return config.browserBackend === "playwright"
    ? createPlaywrightBrowserClient(config)
    : createAgentBrowserClient(config);
}
