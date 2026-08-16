import type { SourceAuthMode, SourceBlock, SourceCatalog, SourceCapability } from "./types.js";
import { validateSourceCatalog } from "./catalog.js";

export interface LegacySourceInput {
  moodle?: { url?: string; configured: boolean };
  cis?: { url?: string; configured: boolean };
  calendar?: { url?: string; configured: boolean };
}

export function projectLegacySourceCatalog(input: LegacySourceInput): SourceCatalog {
  const connections: SourceCatalog["connections"] = [];
  const sources: SourceBlock[] = [];

  addLegacySource({
    configured: input.moodle?.configured ?? false,
    url: input.moodle?.url,
    id: "legacy-moodle",
    label: "Moodle",
    adapterId: "moodle",
    kind: "moodle-course",
    authMode: "password",
    capabilities: [
      "content.search",
      "content.list",
      "content.read",
      "content.download",
      "course.structure.read",
      "quiz.completed-attempt.read",
    ],
    connections,
    sources,
  });
  addLegacySource({
    configured: input.cis?.configured ?? false,
    url: input.cis?.url,
    id: "legacy-cis",
    label: "Student portal",
    adapterId: "fh-technikum-cis",
    kind: "website",
    authMode: "password",
    capabilities: ["content.search", "content.list", "content.read", "calendar.events.read"],
    connections,
    sources,
  });
  addLegacySource({
    configured: input.calendar?.configured ?? false,
    url: input.calendar?.url,
    id: "legacy-calendar",
    label: "Calendar",
    adapterId: "ical",
    kind: "calendar",
    authMode: "bearer-url",
    capabilities: ["calendar.events.read"],
    connections,
    sources,
  });

  return validateSourceCatalog({ version: 1, revision: 0, connections, sources });
}

function addLegacySource(input: {
  configured: boolean;
  url?: string;
  id: string;
  label: string;
  adapterId: string;
  kind: SourceBlock["kind"];
  authMode: SourceAuthMode;
  capabilities: SourceCapability[];
  connections: SourceCatalog["connections"];
  sources: SourceBlock[];
}): void {
  if (!input.configured && !input.url) return;
  const origin = publicOrigin(input.url);
  const connectionId = `${input.id}-connection`;
  input.connections.push({
    version: 1,
    id: connectionId,
    adapterId: input.adapterId,
    adapterVersion: "legacy-v1",
    label: input.label,
    displayOrigin: origin,
    allowedOrigins: [origin],
    auth: {
      mode: input.authMode,
      state: input.configured ? "configured" : "not-configured",
    },
    revision: 0,
  });
  input.sources.push({
    version: 1,
    id: input.id,
    label: input.label,
    kind: input.kind,
    enabled: true,
    connectionId,
    priority: input.kind === "calendar" ? 10 : input.kind === "moodle-course" ? 20 : 30,
    scope: { allowedOrigins: [origin], pathPrefixes: [], courseIds: [], mailFolders: [], tags: ["legacy"] },
    capabilities: input.capabilities,
    policy: {
      authenticatedReads: "allowed",
      downloads: "allowed",
      remoteDrafts: "denied",
      emailSend: "denied",
    },
    health: { status: "unknown" },
    revision: 0,
  });
}

function publicOrigin(value: string | undefined): string {
  if (!value) return "https://unconfigured.invalid";
  const normalized = value.replace(/^webcal:\/\//i, "https://");
  const parsed = new URL(normalized);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopback(parsed.hostname))) {
    throw new Error("Legacy source URLs require HTTPS.");
  }
  parsed.username = "";
  parsed.password = "";
  return parsed.origin;
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

