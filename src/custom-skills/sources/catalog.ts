import type {
  SourceBlock,
  SourceCapability,
  SourceCatalog,
  SourceConnection,
} from "./types.js";
import { SourceCatalogSchema } from "./types.js";

export interface SourceSelection {
  selected: SourceBlock[];
  missingCapabilities: SourceCapability[];
  reason: string;
}

export function validateSourceCatalog(value: unknown): SourceCatalog {
  const catalog = SourceCatalogSchema.parse(value);
  const connections = uniqueById(catalog.connections, "connection");
  for (const connection of connections.values()) {
    assertOriginOnly(connection.displayOrigin, `Connection ${connection.id} display origin`);
    for (const origin of connection.allowedOrigins) {
      assertOriginOnly(origin, `Connection ${connection.id} allowed origin`);
    }
  }
  uniqueById(catalog.sources, "source");
  const sourceIds = new Set(catalog.sources.map((source) => source.id));
  for (const source of catalog.sources) {
    if (!connections.has(source.connectionId)) {
      throw new Error(`Source ${source.id} references missing connection ${source.connectionId}.`);
    }
    if (source.parentSourceId && !sourceIds.has(source.parentSourceId)) {
      throw new Error(`Source ${source.id} references missing parent ${source.parentSourceId}.`);
    }
    assertSourceOrigins(source, connections.get(source.connectionId)!);
  }
  return catalog;
}

export function selectSourcesForCapabilities(
  catalogInput: SourceCatalog,
  requiredCapabilities: readonly SourceCapability[],
): SourceSelection {
  const catalog = validateSourceCatalog(catalogInput);
  const missing = new Set(requiredCapabilities);
  const candidates = catalog.sources.filter((source) => source.enabled);
  const selected: SourceBlock[] = [];

  while (missing.size > 0) {
    const best = candidates
      .filter((source) => !selected.some((entry) => entry.id === source.id))
      .map((source) => ({
        source,
        coverage: source.capabilities.filter((capability) => missing.has(capability)).length,
      }))
      .filter((entry) => entry.coverage > 0)
      .sort((left, right) =>
        right.coverage - left.coverage ||
        left.source.priority - right.source.priority ||
        left.source.label.localeCompare(right.source.label) ||
        left.source.id.localeCompare(right.source.id)
      )[0];
    if (!best) break;
    selected.push(best.source);
    for (const capability of best.source.capabilities) missing.delete(capability);
  }

  const missingCapabilities = [...missing];
  return {
    selected,
    missingCapabilities,
    reason: missingCapabilities.length === 0
      ? `Selected ${selected.length} enabled source block(s) by declared capability.`
      : `No enabled source covers: ${missingCapabilities.join(", ")}.`,
  };
}

function uniqueById<T extends { id: string }>(items: readonly T[], label: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items) {
    if (result.has(item.id)) throw new Error(`Duplicate ${label} id ${item.id}.`);
    result.set(item.id, item);
  }
  return result;
}

function assertSourceOrigins(source: SourceBlock, connection: SourceConnection): void {
  const connectionOrigins = new Set(connection.allowedOrigins.map(normalizeOrigin));
  for (const value of source.scope.allowedOrigins) {
    assertOriginOnly(value, `Source ${source.id} allowed origin`);
    const origin = normalizeOrigin(value);
    if (!connectionOrigins.has(origin)) {
      throw new Error(`Source ${source.id} origin ${origin} is outside connection scope.`);
    }
  }
}

function normalizeOrigin(value: string): string {
  const url = new URL(value);
  if (url.username || url.password) throw new Error("Source origins must not contain credentials.");
  return url.origin;
}

function assertOriginOnly(value: string, label: string): void {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${label} must contain only a public origin.`);
  }
}
