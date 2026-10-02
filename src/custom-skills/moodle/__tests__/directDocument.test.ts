import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, link, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeDirectDocument } from "../directDocument.js";
import * as validation from "../validation.js";
import { runBoundedProcess } from "../../shared/boundedProcess.js";

let workspace: string;
let environment: NodeJS.ProcessEnv;
let deliveries: string[];
beforeEach(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "direct-document-test-"));
  environment = { ...process.env, STUDY_BUDDY_WORKSPACE: workspace,
    STUDY_BUDDY_DOCUMENT_OWNER_THREAD_ID: "owner-a", STUDY_BUDDY_WORKSPACE_KIND: "project",
    MOODLE_PASSWORD: "sentinel-portal-password", CIS_PASSWORD: "sentinel-other-password", TEST_API_KEY: "sentinel-api-key" };
  deliveries = [];
});
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(deliveries.map(file => unlink(file).catch(() => {})));
  await rm(workspace, { recursive: true, force: true });
});
const document = (body = "Confirmed source-backed explanation.") => `#import "study-buddy-components.typ": *
#sb-document(title: "Reviewed notes", short-title: "Notes", course: "Confirmed context", kind: "Study Guide", semester: "", status: "Source-grounded", date: "", body: [
#heading(level: 1)[Learning context]
${body}
])`;
async function prepare() {
  const prepared = await executeDirectDocument({ op: "prepare", prompt: 'Erstelle eine kurze Lernunterlage mit Quellen und Beispielen. "Originalauftrag"' }, environment);
  expect(prepared.ok).toBe(true);
  return prepared.runDir!;
}
async function author(runDir: string, body?: string) { await writeFile(path.join(runDir, "document.typ"), document(body)); }

describe("direct native-owner document tools", () => {
  it("provides the original prompt, template, approved components and an honest fresh state", async () => {
    const runDir = await prepare();
    expect(runDir).toContain(path.join("study-buddy-data", "threads", "owner-a", "direct-documents"));
    expect(await readFile(path.join(runDir, "brief.txt"), "utf8")).toContain('"Originalauftrag"');
    expect(await readFile(path.join(runDir, "template-reference.txt"), "utf8")).toContain("#sb-document");
    const state = JSON.parse(await readFile(path.join(runDir, "direct-document.json"), "utf8"));
    expect(state).toMatchObject({ kind: "direct_document", status: "prepared", extracted_data: {}, moodle_raw_text: "", retry_count: 0, error_log: null });
    expect(state).not.toHaveProperty("qualityReview");
  });

  it("compiles real files, renders every composed page and publishes an identical unused copy", async () => {
    const runDir = await prepare();
    await author(runDir, "First page source-backed explanation.\n#pagebreak()\nSecond page checked example: $ x = 2 $.");
    const original = await readFile(path.join(runDir, "document.typ"));
    const compile = await executeDirectDocument({ op: "compile", runDir }, environment);
    expect(compile).toMatchObject({ ok: true, status: "compiled", technicalChecks: "passed", factualReview: "owner_required" });
    expect(Number(compile.pageCount)).toBeGreaterThanOrEqual(2);
    const previews = compile.previews as Array<{ page: number; path: string }>;
    expect(previews).toHaveLength(Number(compile.pageCount));
    for (const preview of previews) expect((await readFile(preview.path)).length).toBeGreaterThan(0);
    expect(await readFile(path.join(runDir, "document.typ"))).toEqual(original);
    const filename = `direct-document-${randomUUID()}.pdf`;
    const occupied = path.join("/tmp", filename);
    await writeFile(occupied, "Existing delivery must remain unchanged."); deliveries.push(occupied);
    const published = await executeDirectDocument({ op: "publish", runDir, filename }, environment);
    expect(published).toMatchObject({ ok: true, status: "published", kind: "direct_document", sourceStatus: "not_attached", factualReview: "owner_responsibility" });
    deliveries.push(published.deliveryPath as string);
    expect(published.deliveryPath).not.toBe(occupied);
    expect(await readFile(occupied, "utf8")).toBe("Existing delivery must remain unchanged.");
    expect(await readFile(published.deliveryPath as string)).toEqual(await readFile(path.join(runDir, "document.pdf")));
    expect(await readFile(path.join(runDir, "document.typ"))).toEqual(original);
  }, 30_000);

  it("returns the real unknown-variable diagnostic, allows same-file repair, and never rewrites math", async () => {
    const runDir = await prepare();
    await author(runDir, "$ unresolvedfunction(x) $");
    const first = await executeDirectDocument({ op: "compile", runDir }, environment);
    expect(first).toMatchObject({ ok: false, retry_count: 1 });
    expect(first.error).toContain("unknown variable");
    expect(await readFile(path.join(runDir, "document.typ"), "utf8")).toContain("unresolvedfunction(x)");
    await author(runDir, "$ x = 2 $");
    expect(await executeDirectDocument({ op: "compile", runDir }, environment)).toMatchObject({ ok: true, retry_count: 1 });
  }, 30_000);

  it("ends after three failed validations even if files are subsequently fixed", async () => {
    const runDir = await prepare();
    for (let attempt = 1; attempt <= 3; attempt++) expect(await executeDirectDocument({ op: "compile", runDir }, environment)).toMatchObject({ ok: false, retry_count: attempt });
    await author(runDir);
    expect(await executeDirectDocument({ op: "compile", runDir }, environment)).toMatchObject({ ok: false, retry_count: 3, error: "Three unsuccessful validations ended this document invocation." });
    expect(await executeDirectDocument({ op: "publish", runDir }, environment)).toMatchObject({ ok: false, retry_count: 3 });
  });

  it("rejects publication without a successful current-file compile", async () => {
    const runDir = await prepare();
    expect(await executeDirectDocument({ op: "publish", runDir }, environment)).toMatchObject({ ok: false });
  });

  it.each(["document.typ", "document.pdf", "data.txt"])("rejects a changed %s instead of publishing a stale PDF", async filename => {
    const runDir = await prepare();
    await writeFile(path.join(runDir, "data.txt"), "Original native record.");
    await author(runDir, '#read("data.txt")');
    expect(await executeDirectDocument({ op: "compile", runDir }, environment)).toMatchObject({ ok: true });
    await writeFile(path.join(runDir, filename), "Changed after successful compile.");
    const result = await executeDirectDocument({ op: "publish", runDir }, environment);
    expect(result).toMatchObject({ ok: false });
    expect(result.error).toContain("changed since the last successful compile");
  }, 30_000);

  it("retains source provenance and rejects a changed original source file", async () => {
    const runDir = await prepare();
    const sourceRoot = path.resolve(runDir, "..", "..", "direct-sources");
    await mkdir(sourceRoot);
    const localPath = path.join(sourceRoot, "original.txt");
    const content = "Confirmed original announcement.";
    await writeFile(localPath, content);
    const sha256 = createHash("sha256").update(content).digest("hex");
    const manifest = { version: 1, untrusted: true, sources: [{ id: "native-record", title: "Original source", url: "https://example.org/course", localPath, sha256 }] };
    await writeFile(path.join(runDir, "sources-manifest.json"), JSON.stringify(manifest));
    await author(runDir);
    expect(await executeDirectDocument({ op: "compile", runDir }, environment)).toMatchObject({ ok: true });
    const published = await executeDirectDocument({ op: "publish", runDir, filename: `provenance-${randomUUID()}.pdf` }, environment);
    deliveries.push(published.deliveryPath as string);
    expect(published).toMatchObject({ ok: true, sourceStatus: "attached", sourceCount: 1 });
    expect(JSON.parse(await readFile(published.provenancePath as string, "utf8"))).toEqual(manifest);
    await writeFile(localPath, "Modified original source.");
    expect((await executeDirectDocument({ op: "publish", runDir }, environment)).error).toContain("no longer matches its provenance hash");
  }, 30_000);

  it("does not let payloads select another workspace or thread", async () => {
    await expect(executeDirectDocument({ op: "prepare", prompt: "x", workspace }, environment)).rejects.toThrow();
    const runDir = await prepare();
    await expect(executeDirectDocument({ op: "compile", runDir }, { ...environment, STUDY_BUDDY_DOCUMENT_OWNER_THREAD_ID: "owner-b" })).rejects.toThrow("outside");
    await expect(executeDirectDocument({ op: "compile", runDir: workspace }, environment)).rejects.toThrow("outside");
    await expect(executeDirectDocument({ op: "prepare", prompt: "x" }, {})).rejects.toThrow("broker-owned");
  });

  it("uses the direct root for a native Quick Chat", async () => {
    const quick = path.join(workspace, "quick-chats", "owner-a");
    await mkdir(quick, { recursive: true });
    const prepared = await executeDirectDocument({ op: "prepare", prompt: "x" }, { ...environment, STUDY_BUDDY_WORKSPACE: quick, STUDY_BUDDY_WORKSPACE_KIND: "quick-chat" });
    expect(path.dirname(path.dirname(prepared.runDir!))).toBe(path.join(quick, "study-buddy-data"));
  });

  it.each(["symlink", "hardlink"])("rejects a %s to an external sentinel before broker reading/compiling", async kind => {
    const runDir = await prepare();
    const external = path.join(workspace, "external-sentinel.txt");
    await writeFile(external, "External sentinel must not be read through a link.");
    const target = path.join(runDir, "document.typ");
    await unlink(target);
    if (kind === "symlink") await symlink(external, target); else await link(external, target);
    const compiled = await executeDirectDocument({ op: "compile", runDir }, environment);
    expect(compiled.ok).toBe(false);
    expect(compiled.error).toMatch(/symlink|hardlink/);
    expect(await readFile(external, "utf8")).toBe("External sentinel must not be read through a link.");
  });

  it("rejects a symlinked data root before preparing artifacts outside the workspace", async () => {
    const external = await mkdtemp(path.join(os.tmpdir(), "direct-external-root-"));
    try {
      await symlink(external, path.join(workspace, "study-buddy-data"), "dir");
      await expect(executeDirectDocument({ op: "prepare", prompt: "x" }, environment)).rejects.toThrow("symlink");
    } finally { await rm(external, { recursive: true, force: true }); }
  });

  it("passes a minimal credential-free environment to the actual compiler", async () => {
    const original = validation.compileTypstPdf;
    const spy = vi.spyOn(validation, "compileTypstPdf").mockImplementation(async (source, target, options) => {
      expect(options?.env).toBeDefined();
      expect(options?.env).not.toHaveProperty("MOODLE_PASSWORD");
      expect(options?.env).not.toHaveProperty("CIS_PASSWORD");
      expect(options?.env).not.toHaveProperty("TEST_API_KEY");
      return original(source, target, options);
    });
    const runDir = await prepare(); await author(runDir);
    expect(await executeDirectDocument({ op: "compile", runDir }, environment)).toMatchObject({ ok: true });
    expect(spy).toHaveBeenCalledOnce();
  }, 30_000);

  it("exposes exactly one JSON result through the actual CLI entrypoint", async () => {
    const execution = await runBoundedProcess(process.execPath, ["--import", "tsx", path.resolve("src/custom-skills/moodle/directDocumentCli.ts"), JSON.stringify({ op: "prepare", prompt: "Original CLI request." })], { env: environment });
    expect(execution.code).toBe(0);
    expect(JSON.parse(execution.stdout)).toMatchObject({ ok: true, op: "prepare", kind: "direct_document" });
    expect(execution.stderr).not.toContain("sentinel-");
  }, 30_000);
});
