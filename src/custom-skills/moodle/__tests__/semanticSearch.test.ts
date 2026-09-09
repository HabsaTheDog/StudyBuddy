import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { resolveSemanticSearch, type SearchCandidate } from "../semanticSearch.js";
import { resolveTaskModelPolicy } from "../modelPolicy.js";
import { resolveCodexTaskAccessPolicy } from "../codexClient.js";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
const candidates: SearchCandidate[] = [
  { id: "c1", label: "MAES2 Mathematik SS2026", url: "https://m.example/course/view.php?id=21" },
  { id: "c2", label: "MAES3 Mathematik WS2026", url: "https://m.example/course/view.php?id=22" },
];
async function fixture(decisions: unknown[]) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "semantic-search-")); dirs.push(dir);
  const model = { run: vi.fn(async () => JSON.stringify(decisions.shift() ?? { action: "clarify", ids: [], reason: "ambiguous", evidence: [] })) };
  const reader = { inspect: vi.fn(async (c: SearchCandidate) => ({ ...c, text: c.id === "c2" ? "Präsenz am 09.09.2026: Fourier" : "Kurs abgeschlossen am 30.06.2026" })), search: vi.fn(async () => candidates) };
  return { prompt: "Was ist morgen für Mathe?", context: "2026-09-09", candidates, reader, model, runDir: dir, cacheDir: path.join(dir, "cache"), sourceScope: "m.example/current-user" };
}
const inspect = { action: "inspect", ids: ["c1", "c2"], query: "", reason: "Compare semesters", evidence: [] };
const resolve = { action: "resolve", ids: ["c2"], query: "", reason: "Current semester and requested lesson", evidence: [{ id: "c2", quote: "Präsenz am 09.09.2026" }] };

it("resolves Mathe across MAES semesters through actual inspected evidence", async () => {
  const input = await fixture([inspect, resolve]);
  const result = await resolveSemanticSearch(input);
  expect(result.selectedIds).toEqual(["c2"]);
  expect(input.reader.inspect).toHaveBeenCalledTimes(2);
  expect(input.model.run.mock.calls.length).toBe(2);
});
it("refines a zero-match query before reading a discovered candidate", async () => {
  const input = await fixture([{ action: "search", ids: [], query: "Mathematik", reason: "Alias", evidence: [] }, inspect, resolve]);
  input.candidates = [];
  expect((await resolveSemanticSearch(input)).selectedIds).toEqual(["c2"]);
  expect(input.reader.search).toHaveBeenCalledWith("Mathematik");
});
it("rejects invented IDs and unsupported quotes after three invalid decisions", async () => {
  const input = await fixture([inspect, { ...resolve, ids: ["invented"] }, { ...resolve, evidence: [{ id: "c2", quote: "invented proof" }] }, { ...resolve, evidence: [] }]);
  expect((await resolveSemanticSearch(input)).status).toBe("ambiguous");
});
it("rechecks cached evidence and rejects stale course facts", async () => {
  const input = await fixture([inspect, resolve]);
  await resolveSemanticSearch(input);
  input.model.run.mockClear();
  expect((await resolveSemanticSearch(input)).method).toBe("cache");
  expect(input.model.run).not.toHaveBeenCalled();
  input.reader.inspect.mockImplementation(async c => ({ ...c, text: "Kurs jetzt archiviert" }));
  expect((await resolveSemanticSearch(input)).status).toBe("ambiguous");
});
it("preserves the literal URL fast path without a model call", async () => {
  const input = await fixture([]); input.prompt = candidates[0].url;
  expect((await resolveSemanticSearch(input)).method).toBe("direct");
  expect(input.model.run).not.toHaveBeenCalled();
});
it("uses Luna for source search with the existing restricted worker boundary", () => {
  expect(resolveTaskModelPolicy({ profile: "balanced", task: "source_search" }).model).toBe("gpt-5.6-luna");
  expect(resolveCodexTaskAccessPolicy("source_search")).toMatchObject({ leafWorker: true, sandboxMode: "read-only", networkAccessEnabled: false });
});
it("never accepts the label of a source whose inspection failed as verification", async () => {
  const input = await fixture([inspect, { ...resolve, evidence: [{ id: "c2", quote: candidates[1].label }] }]);
  input.reader.inspect.mockRejectedValue(new Error("source unavailable"));
  expect((await resolveSemanticSearch(input)).status).toBe("ambiguous");
});
it("reuses verified mappings across clock instants while retaining the requested date boundary", async () => {
  const input = await fixture([inspect, resolve]);
  input.context = JSON.stringify({ resolvedAt: "2026-09-08T12:00:00Z", start: "2026-09-09T00:00:00Z" });
  await resolveSemanticSearch(input);
  input.context = JSON.stringify({ resolvedAt: "2026-09-08T12:01:00Z", start: "2026-09-09T00:00:00Z" });
  expect((await resolveSemanticSearch(input)).method).toBe("cache");
});

it("requires actual inspection when resolving a broken reference even if one title matches literally", async () => {
  const input = await fixture([inspect, resolve]);
  const result = await resolveSemanticSearch({ ...input, prompt: candidates[1].label, requireInspection: true });
  expect(result.method).toBe('model');
  expect(input.reader.inspect).toHaveBeenCalled();
});

it("rejects a replacement whose ID and quotation are real but whose unique equivalence is unsupported", async () => {
  const input = await fixture([inspect, resolve, { supported: false, reason: 'Several homework tasks share this general topic.' }]);
  const result = await resolveSemanticSearch({ ...input, requireInspection: true });
  expect(result.status).toBe('ambiguous');
  expect(result.selectedIds).toEqual([]);
});
