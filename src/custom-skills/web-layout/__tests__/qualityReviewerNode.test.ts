import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWebLayoutRuntimeConfig } from "../config.js";
import { createQualityReviewerNode } from "../nodes/qualityReviewerNode.js";
import type { RequestContract } from "../../shared/requestContract.js";

const tempDirs: string[] = [];
const previousWorkspace = process.env.STUDY_BUDDY_WORKSPACE;

afterEach(async () => {
  if (previousWorkspace === undefined) delete process.env.STUDY_BUDDY_WORKSPACE;
  else process.env.STUDY_BUDDY_WORKSPACE = previousWorkspace;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("web layout semantic quality input", () => {
  it("reviews only the interactive deliverable in a combined HTML and PDF request", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "web-layout-quality-scope-"));
    tempDirs.push(workspace);
    process.env.STUDY_BUDDY_WORKSPACE = workspace;
    const config = createWebLayoutRuntimeConfig({
      prompt: "Create an interactive guide and a compact PDF",
      originalUserPrompt: "Create an interactive guide and a compact PDF",
      kind: "study-guide",
      requestName: "combined-deliverable-review-test",
      skipBrowserValidation: true,
    });
    await mkdir(path.join(config.runDir, ".build"), { recursive: true });
    await writeFile(
      path.join(config.runDir, ".build", "document.html"),
      "<!doctype html><html><body>Interactive guide</body></html>",
      "utf8",
    );
    let receivedPrompt = "";
    let receivedAttempt = 0;
    const result = await createQualityReviewerNode(config, {
      run: async (prompt: string, options: { attempt?: number }) => {
        receivedPrompt = prompt;
        receivedAttempt = options.attempt ?? 0;
        return JSON.stringify({
          ok: false,
          summary: "The PDF is missing",
          findings: [
            {
              requirementId: "req_pdf",
              deliverableId: "pdf",
              owner: "content",
              severity: "blocking",
              verdict: "fail",
              targetId: "pdf",
              message: "The compact PDF was not supplied with this HTML page.",
              repairInstruction: "Provide the PDF.",
            },
          ],
        });
      },
    })({
      source_text: "source",
      html_document: "",
      validation_report: { ok: true },
      request_contract: combinedContract(),
      retry_count: 7,
      quality_retry_count: 0,
    } as never);

    expect(result.error_log).toBeNull();
    expect(receivedAttempt).toBe(1);
    expect(receivedPrompt).toContain("ONLY the interactive HTML deliverable");
    expect(receivedPrompt).toContain('"id": "html"');
    expect(receivedPrompt).toContain('"id": "req_html"');
    expect(receivedPrompt).not.toContain('"id": "req_pdf"');
    const persisted = JSON.parse(await readFile(path.join(config.runDir, "quality-review.json"), "utf8")) as {
      ok: boolean;
      findings: unknown[];
    };
    expect(persisted).toMatchObject({ ok: true, findings: [] });
  });

  it("reviews the bundled delivery artifact rather than local source references", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "web-layout-quality-"));
    tempDirs.push(workspace);
    process.env.STUDY_BUDDY_WORKSPACE = workspace;
    const config = createWebLayoutRuntimeConfig({
      prompt: "Review the offline guide",
      kind: "study-guide",
      requestName: "bundled-review-test",
      skipBrowserValidation: true,
    });
    await mkdir(path.join(config.runDir, ".build"), { recursive: true });
    await writeFile(
      path.join(config.runDir, ".build", "document.html"),
      '<!doctype html><html><body><img src="data:image/webp;base64,AAAA" alt="Study Buddy"></body></html>',
      "utf8",
    );
    let receivedPrompt = "";
    const codex = {
      run: async (prompt: string) => {
        receivedPrompt = prompt;
        return JSON.stringify({ ok: true, summary: "ok", findings: [] });
      },
    };

    await createQualityReviewerNode(config, codex)({
      source_text: "source",
      html_document: '<!doctype html><img src="assets/logo.png">',
      validation_report: {},
      retry_count: 0,
      quality_retry_count: 0,
    } as never);

    expect(receivedPrompt).toContain("data:image/webp;base64,[embedded binary omitted: 4 chars]");
    expect(receivedPrompt).not.toContain('src="assets/logo.png"');
    expect(receivedPrompt).toContain("necessarily still marked running");
    expect(receivedPrompt).toContain("Do not inspect or reject run-summary.md");
    expect(receivedPrompt).toContain("Reject a study guide that uses a persistent left sidebar");
    expect(receivedPrompt).toContain("source-authentic interaction types");
    expect(receivedPrompt).toContain("repair owner (source, content, interaction, visual, or technical)");
  });

  it("ignores self-referential run-status findings while preserving real HTML findings", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "web-layout-quality-"));
    tempDirs.push(workspace);
    process.env.STUDY_BUDDY_WORKSPACE = workspace;
    const config = createWebLayoutRuntimeConfig({
      prompt: "Review the offline guide",
      requestName: "orchestration-finding-test",
      skipBrowserValidation: true,
    });
    await mkdir(path.join(config.runDir, ".build"), { recursive: true });
    await writeFile(
      path.join(config.runDir, ".build", "document.html"),
      "<!doctype html><html><body>Guide</body></html>",
      "utf8",
    );
    const codex = {
      run: async () => JSON.stringify({
        ok: false,
        summary: "Two findings",
        findings: [
          {
            requirementId: null,
            deliverableId: null,
            owner: "technical",
            severity: "blocking",
            verdict: "fail",
            targetId: null,
            message: "run-summary.md still says Run status: running and error.log is missing.",
            repairInstruction: "Wait for terminal orchestration.",
          },
          {
            requirementId: "interactive-practice",
            deliverableId: "html-guide",
            owner: "interaction",
            severity: "blocking",
            verdict: "fail",
            targetId: "question-1",
            message: "The answer feedback reveals the solution before submission.",
            repairInstruction: "Hide the feedback until submission for this question.",
          },
        ],
      }),
    };

    const result = await createQualityReviewerNode(config, codex)({
      source_text: "source",
      html_document: "<!doctype html><html><body>Guide</body></html>",
      validation_report: {},
      retry_count: 0,
      quality_retry_count: 0,
    } as never);

    expect(result.error_log).toContain("reveals the solution");
    expect(result.error_log).not.toContain("run-summary.md");
    expect(result.quality_retry_count).toBe(1);
  });

  it("keeps the final semantic review below its model budget without dropping visible learner content", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "web-layout-quality-budget-"));
    tempDirs.push(workspace);
    process.env.STUDY_BUDDY_WORKSPACE = workspace;
    const config = createWebLayoutRuntimeConfig({
      prompt: "Create the exact DYN2 interactive guide CONTRACT_MARKER",
      kind: "study-guide",
      requestName: "bounded-quality-review-test",
      skipBrowserValidation: true,
    });
    await mkdir(path.join(config.runDir, ".build"), { recursive: true });
    await writeFile(
      path.join(config.runDir, ".build", "document.html"),
      `<!doctype html><html><head><style>${".x{color:red}".repeat(20_000)}</style></head><body><h1>VISIBLE LEARNER HEADING</h1><p>${"learner explanation ".repeat(1_000)}</p><script>${"window.x=1;".repeat(20_000)}</script></body></html>`,
      "utf8",
    );
    let receivedPrompt = "";
    const result = await createQualityReviewerNode(config, {
      run: async (prompt: string) => {
        receivedPrompt = prompt;
        return JSON.stringify({ ok: true, summary: "ok", findings: [] });
      },
    })({
      source_text: "source ".repeat(30_000),
      study_guide_content: { marker: "content ".repeat(30_000) },
      html_document: "",
      validation_report: { details: "validation ".repeat(10_000) },
      request_contract: combinedContract(),
      retry_count: 0,
      quality_retry_count: 0,
    } as never);

    expect(result.error_log).toBeNull();
    expect(receivedPrompt.length).toBeLessThan(44_000);
    expect(receivedPrompt).toContain("CONTRACT_MARKER");
    expect(receivedPrompt).toContain("VISIBLE LEARNER HEADING");
    expect(receivedPrompt).toContain("[stylesheet omitted]");
    expect(receivedPrompt).toContain("[runtime omitted]");
    expect(receivedPrompt).not.toContain("window.x=1");
  });
});

function combinedContract(): RequestContract {
  return {
    schemaVersion: 1,
    evaluationStatus: "evaluated",
    originalPrompt: "Create an interactive guide and a compact PDF",
    userGoal: "Study with both deliverables",
    deliverables: [
      { id: "html", kind: "interactive study guide", purpose: "Self testing" },
      { id: "pdf", kind: "compact PDF study reference", purpose: "Compact reference" },
    ],
    requirements: [
      {
        id: "req_html",
        statement: "The interactive guide supports self testing",
        origin: "explicit",
        priority: "must",
        appliesTo: ["html"],
        acceptanceCheck: "The learner can answer and check questions",
        evidenceRefs: [],
      },
      {
        id: "req_pdf",
        statement: "The PDF contains compact derivations",
        origin: "explicit",
        priority: "must",
        appliesTo: ["pdf"],
        acceptanceCheck: "The PDF is compact and complete",
        evidenceRefs: [],
      },
    ],
    notRequired: [],
    forbidden: [],
    contentStrategy: {
      summary: "Use the right medium for each deliverable",
      quantityBasis: "No fixed quota",
      completionRule: "Review each deliverable in its own workflow",
    },
    reviewAssignments: [
      { owner: "interaction", requirementIds: ["req_html"], checks: ["Check the HTML"] },
      { owner: "content", requirementIds: ["req_pdf"], checks: ["Check the PDF"] },
    ],
  };
}
