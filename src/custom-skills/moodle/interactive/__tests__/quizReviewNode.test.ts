import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AgentBrowserClient,
  AgentBrowserCommandResult,
  AgentBrowserSnapshot,
} from "../agentBrowserClient.js";
import type { CodexClient } from "../codexClient.js";
import {
  clickSafeNextPage,
  createQuizReviewNode,
  discoverQuizTarget,
  generateAnswerSpec,
} from "../nodes/quizReviewNode.js";
import { createQuizPageNode, createQuizTargetNode } from "../nodes/quizWorkflowNodes.js";
import {
  buildPendingQuizPermissionRequest,
  claimApprovedQuizPermission,
  loadApprovedQuizPermission,
  persistPendingQuizPermission,
} from "../quizPermissions.js";
import { initialAgentState } from "../state.js";
import type { MoodleRuntimeConfig, QuizSafetyPolicy } from "../types.js";
import type { QuizMetadata } from "../quizSafetyPolicy.js";

let runDir: string | null = null;

afterEach(async () => {
  if (runDir) {
    await rm(runDir, { recursive: true, force: true });
    runDir = null;
  }
});

describe("quizReviewNode", () => {
  it("retries a malformed Quiz Solver answer with the retry role policy", async () => {
    const calls: Array<{ task?: string; attempt?: number }> = [];
    const codex: CodexClient = {
      async run(_prompt, options) {
        calls.push({ task: options?.task, attempt: options?.attempt });
        if (options?.attempt === 1) return "not-json";
        return JSON.stringify({
          question_id: "question-1",
          question_index: 1,
          answer: "4",
          answers: [],
          confidence: 0.95,
          citations: ["visible option 4"],
          rationale: "2+2=4.",
          risk_flags: [],
          control_answers: [],
        });
      },
    };

    await expect(generateAnswerSpec(codex, { question: "2+2?" })).resolves.toMatchObject({
      answer: "4",
      confidence: 0.95,
    });
    expect(calls).toEqual([
      { task: "quiz_solver", attempt: 1 },
      { task: "quiz_solver", attempt: 2 },
    ]);
  });

  it("reviews a direct quiz URL and never final-submits", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-quiz-"));
    const client = new FakeQuizBrowserClient();
    const codex: CodexClient = {
      async run() {
        return JSON.stringify({
          question_id: "question-1",
          question_index: 1,
          answer: "4",
          answers: [],
          confidence: 0.95,
          citations: ["visible option 4"],
          rationale: "2+2=4.",
          risk_flags: [],
        });
      },
    };
    const node = createQuizReviewNode(testConfig(runDir, allowQuizWorkPolicy()), {
      agentBrowser: client,
      codex,
    });

    const result = await node(initialAgentState);

    expect(result.error_log).toBeNull();
    expect(result.final_document).toContain("Final submit clicked: false");
    expect(result.final_document).toContain("Was ist 2+2?");
    expect(result.final_document).toContain(
      "filled=false persisted=false reason=answer-not-persisted",
    );
    expect(result.final_document).toMatch(
      /== Quiz öffnen\n\n#link\("https:\/\/moodle\.example\/mod\/quiz\/view\.php\?id=123"\)\[Quiz in Moodle öffnen\]\n$/,
    );
    expect(client.calls).toContain("click:@e-start");
    expect(client.calls.some((call) => /submit all|endgültig|endgueltig/i.test(call))).toBe(false);
    await expect(readFile(path.join(runDir, "quiz-review.json"), "utf8")).resolves.toContain(
      '"final_submit_clicked": false',
    );
  });

  it("blocks risky quiz starts with conservative defaults", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-quiz-"));
    const client = new FakeQuizBrowserClient();
    const node = createQuizReviewNode(testConfig(runDir), { agentBrowser: client });

    const result = await node(initialAgentState);

    expect(result.error_log).toBeNull();
    expect(result.final_document).toContain("status: blocked");
    expect(result.final_document).toContain("reason: starting-or-continuing-attempts-disabled");
    expect(result.final_document).toContain("needed permission: allow_start_or_continue_attempt");
    expect(client.calls).not.toContain("click:@e-start");
  });

  it("uses the opened Moodle quiz title in an ask-before-attempt permission request", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-quiz-permission-title-"));
    const config = testConfig(runDir, {
      ...allowQuizWorkPolicy(),
      accessMode: "ask-before-attempt",
      askBeforeStartingOrContinuingAttempts: true,
    });
    const node = createQuizPageNode(config, { agentBrowser: new FakeQuizBrowserClient() });

    const result = await node({
      ...initialAgentState,
      extracted_data: {
        quiz_workflow: {
          kind: "quiz_workflow",
          target_url: "https://moodle.example/mod/quiz/view.php?id=123",
          page_number: 1,
          started: false,
          done: false,
          fill_results: [],
          risks: [],
          final_submit_clicked: false,
        },
      },
    });

    expect(result.final_document).toContain("permission_required");
    expect(result.final_document).toMatch(
      /Native approval required[\s\S]*== Quiz öffnen\n\n#link\("https:\/\/moodle\.example\/mod\/quiz\/view\.php\?id=123"\)\[Quiz in Moodle öffnen\]\n$/,
    );
    await expect(
      readFile(path.join(runDir, "quiz-permission-request.json"), "utf8"),
    ).resolves.toContain('"quizTitle": "1. Selbstcheck Test"');
  });

  it("opens a completed attempt review before blocking a new start", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-quiz-"));
    const client = new FakeQuizBrowserClient({
      initialSnapshot: {
        refs: {
          "e-review": { role: "link", name: "Review attempt" },
          "e-start": { role: "button", name: "Test versuchen" },
        },
        snapshot:
          '- link "Review attempt" [ref=e-review] url=https://moodle.example/mod/quiz/review.php?attempt=1\n' +
          '- button "Test versuchen" [ref=e-start]',
      },
    });
    const node = createQuizReviewNode(testConfig(runDir), { agentBrowser: client });

    const result = await node(initialAgentState);

    expect(result.error_log).toBeNull();
    expect(result.final_document).toContain("Was ist 2+2?");
    expect(client.calls).toContain("click:@e-review");
    expect(client.calls).not.toContain("click:@e-start");
  });

  it("recognizes Moodle's German repeat-attempt action as a safe start control", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-quiz-repeat-"));
    const client = new FakeQuizBrowserClient({
      initialSnapshot: {
        refs: { "e-start": { role: "button", name: "Test wiederholen" } },
        snapshot: '- button "Test wiederholen" [ref=e-start]',
      },
    });
    const node = createQuizReviewNode(testConfig(runDir, allowQuizWorkPolicy()), {
      agentBrowser: client,
    });

    await node(initialAgentState);

    expect(client.calls).toContain("click:@e-start");
  });

  it("ignores a parent container whose text contains the start label", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-quiz-start-container-"));
    const client = new FakeQuizBrowserClient({
      initialSnapshot: {
        refs: {
          parent: {
            role: "main",
            name: "Test versuchen Bewertungsmethode: Bester Versuch Bestehensgrenze: 6 von 10",
          },
          "e-start": { role: "button", name: "Test versuchen" },
        },
        snapshot:
          '- main "Test versuchen Bewertungsmethode: Bester Versuch" [ref=parent]\n' +
          '- button "Test versuchen" [ref=e-start]',
      },
    });
    const node = createQuizReviewNode(testConfig(runDir, allowQuizWorkPolicy()), {
      agentBrowser: client,
    });

    await node(initialAgentState);

    expect(client.calls).toContain("click:@e-start");
    expect(client.calls).not.toContain("click:@parent");
  });

  it("does not confuse Weiterbildungsangebote with the quiz next-page control", async () => {
    const client = new FakeQuizBrowserClient({
      initialSnapshot: {
        refs: {
          dashboard: { role: "link", name: "Weiterbildungsangebote" },
          next: { role: "button", name: "Nächste Seite" },
        },
        snapshot:
          '- link "Weiterbildungsangebote" [ref=dashboard]\n' +
          '- button "Nächste Seite" [ref=next]',
      },
    });

    await expect(clickSafeNextPage(client)).resolves.toMatchObject({
      clicked: true,
      ref: "next",
    });
    expect(client.calls).toContain("click:@next");
    expect(client.calls).not.toContain("click:@dashboard");
  });

  it("uses Moodle's last-page control to save answers and open the attempt summary", async () => {
    const client = new FakeQuizBrowserClient({
      initialSnapshot: {
        refs: {
          finish: { role: "button", name: "Versuch abschließen ..." },
          submit: { role: "button", name: "Alles abgeben und beenden" },
        },
        snapshot:
          '- button "Versuch abschließen ..." [ref=finish]\n' +
          '- button "Alles abgeben und beenden" [ref=submit]',
      },
    });

    await expect(clickSafeNextPage(client)).resolves.toMatchObject({
      clicked: true,
      kind: "attempt_summary",
      ref: "finish",
    });
    expect(client.calls).toContain("click:@finish");
    expect(client.calls).not.toContain("click:@submit");
  });

  it("uses the ET2 course href and selects the requested first Selbstcheck", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-quiz-discovery-"));
    const config = {
      ...testConfig(runDir),
      prompt: "Im Moodle-Kurs Elektrotechnik 2 bearbeite den ersten Selbstcheck",
      moodleUrl: "https://moodle.example/my/",
      dashboardUrl: "https://moodle.example/my/",
      maxPages: 3,
    };
    const client = new FakeQuizDiscoveryClient();

    const target = await discoverQuizTarget(config, client);

    expect(target).toBe("https://moodle.example/mod/quiz/view.php?id=101");
    expect(client.calls).toContain("open:https://moodle.example/course/view.php?id=32897");
    expect(client.calls).not.toContain("open:https://moodle.example/course/view.php?id=165657");
    await expect(readFile(path.join(runDir, "quiz-candidates.json"), "utf8")).resolves.toContain(
      '"order": 0',
    );
  });

  it("persists a diagnostic quiz report when discovery finds no target", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-quiz-no-target-"));
    const config = {
      ...testConfig(runDir),
      prompt: "Bearbeite den ersten Selbstcheck in Elektrotechnik 2",
      moodleUrl: "https://moodle.example/my/",
      dashboardUrl: "https://moodle.example/my/",
    };
    const node = createQuizTargetNode(config, {
      agentBrowser: new FakeQuizDiscoveryClient(true),
    });

    const result = await node(initialAgentState);

    expect(result.final_document).toContain("No matching Moodle quiz target");
    await expect(readFile(path.join(runDir, "quiz-review.typ"), "utf8")).resolves.toContain(
      "No matching Moodle quiz target",
    );
  });

  it("selects Test zur 8. Einheit exactly and deduplicates generic Moodle links", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-quiz-unit-target-"));
    const config = {
      ...testConfig(runDir),
      prompt: "In Elektrotechnik 2 bearbeite den Test zur 8. Einheit",
      moodleUrl: "https://moodle.example/my/",
      dashboardUrl: "https://moodle.example/my/",
      maxPages: 3,
    };

    const target = await discoverQuizTarget(config, new FakeQuizDiscoveryClient());
    const candidates = JSON.parse(
      await readFile(path.join(runDir, "quiz-candidates.json"), "utf8"),
    ) as Array<{ title: string; url: string }>;

    expect(target).toBe("https://moodle.example/mod/quiz/view.php?id=208");
    expect(candidates.filter((candidate) => candidate.url.endsWith("id=208"))).toEqual([
      expect.objectContaining({ title: "Test zu 8. Einheit" }),
    ]);
  });

  it("treats negated neighboring units as exclusions instead of ranking terms", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-quiz-unit-negation-"));
    const config = {
      ...testConfig(runDir),
      prompt:
        "Elektrotechnik 2: bearbeite ausschließlich den Test zur 8. Einheit; keinen Test zu 1. und 2. Einheit öffnen.",
      moodleUrl: "https://moodle.example/my/",
      dashboardUrl: "https://moodle.example/my/",
      maxPages: 3,
    };

    await expect(discoverQuizTarget(config, new FakeQuizDiscoveryClient())).resolves.toBe(
      "https://moodle.example/mod/quiz/view.php?id=208",
    );
  });

  it("does not fall back to a neighboring quiz when an exact unit is absent", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-quiz-unit-missing-"));
    const config = {
      ...testConfig(runDir),
      prompt: "In Elektrotechnik 2 bearbeite den Test zur 9. Einheit",
      moodleUrl: "https://moodle.example/my/",
      dashboardUrl: "https://moodle.example/my/",
      maxPages: 3,
    };

    await expect(discoverQuizTarget(config, new FakeQuizDiscoveryClient())).resolves.toBeNull();
  });

  it("blocks a closed quiz without writing a permission request or clicking another control", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-quiz-closed-"));
    const client = new FakeQuizBrowserClient({
      metadataSequence: [closedQuizMetadata()],
    });
    const config = testConfig(runDir, {
      ...allowQuizWorkPolicy(),
      askBeforeStartingOrContinuingAttempts: true,
    });
    const node = createQuizPageNode(config, { agentBrowser: client });

    const result = await node(quizWorkflowState());

    expect(result.final_document).toContain("reason: quiz-closed");
    expect(client.calls.some((call) => call.startsWith("click:"))).toBe(false);
    await expect(
      readFile(path.join(runDir, "quiz-permission-request.json"), "utf8"),
    ).rejects.toThrow();
  });

  it("rechecks live availability immediately before starting an approved quiz", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-quiz-live-recheck-"));
    const client = new FakeQuizBrowserClient({
      metadataSequence: [openQuizMetadata(), closedQuizMetadata()],
    });
    const node = createQuizPageNode(testConfig(runDir, allowQuizWorkPolicy()), {
      agentBrowser: client,
    });

    const result = await node(quizWorkflowState());

    expect(result.final_document).toContain("reason: quiz-closed");
    expect(client.calls).not.toContain("click:@e-start");
  });

  it("keeps an approved quiz grant retryable when page extraction fails before an action", async () => {
    runDir = await mkdtemp(path.join(os.tmpdir(), "moodle-quiz-extraction-failure-"));
    const targetUrl = "https://moodle.example/mod/quiz/view.php?id=123";
    const request = buildPendingQuizPermissionRequest({
      targetUrl,
      decision: {
        status: "permission_required",
        action: "start_or_continue_attempt",
        reason: "quiz-attempt-needs-confirmation",
        neededPermission: "confirm_quiz_attempt",
      },
    });
    const requestPath = await persistPendingQuizPermission(
      { runDir } as MoodleRuntimeConfig,
      request,
    );
    const grant = await loadApprovedQuizPermission(requestPath);
    const config = {
      ...testConfig(runDir, allowQuizWorkPolicy()),
      approvedQuizPermission: grant,
    };
    const node = createQuizPageNode(config, {
      agentBrowser: new InvalidQuizExtractionClient(),
    });

    await expect(
      node({
        ...initialAgentState,
        extracted_data: {
          quiz_workflow: {
            kind: "quiz_workflow",
            target_url: targetUrl,
            page_number: 1,
            started: false,
            done: false,
            fill_results: [],
            risks: [],
            final_submit_clicked: false,
          },
        },
      }),
    ).rejects.toThrow(/Invalid Moodle quiz page extraction/);
    await expect(claimApprovedQuizPermission(grant)).resolves.toBeUndefined();
  });
});

class FakeQuizBrowserClient implements AgentBrowserClient {
  readonly calls: string[] = [];
  private started = false;
  private reviewingPreviousAttempt = false;
  private url = "https://moodle.example/mod/quiz/view.php?id=123";
  private metadataReadCount = 0;

  constructor(
    private readonly options: {
      initialSnapshot?: Pick<AgentBrowserSnapshot, "refs" | "snapshot">;
      metadataSequence?: Array<Partial<QuizMetadata>>;
    } = {},
  ) {}

  async doctor(): Promise<AgentBrowserCommandResult> {
    return ok();
  }

  async open(url: string): Promise<AgentBrowserCommandResult> {
    this.calls.push(`open:${url}`);
    this.url = url;
    return ok();
  }

  async snapshot(): Promise<AgentBrowserSnapshot> {
    if (!this.started && !this.reviewingPreviousAttempt && this.options.initialSnapshot) {
      return {
        origin: this.url,
        refs: this.options.initialSnapshot.refs,
        snapshot: this.options.initialSnapshot.snapshot,
      };
    }
    return {
      origin: this.url,
      refs: { "e-start": { role: "button", name: "Test versuchen" } },
      snapshot: '- button "Test versuchen" [ref=e-start]',
    };
  }

  async getText(): Promise<string> {
    return "Dashboard";
  }

  async getTitle(): Promise<string> {
    return "1. Selbstcheck Test";
  }

  async getUrl(): Promise<string> {
    return this.url;
  }

  async evalJson<T = unknown>(script?: string): Promise<T> {
    if (script?.includes("QUIZ_METADATA_EXTRACTION")) {
      const sequence = this.options.metadataSequence ?? [openQuizMetadata()];
      const selected = sequence[Math.min(this.metadataReadCount, sequence.length - 1)];
      this.metadataReadCount += 1;
      return selected as T;
    }
    if (script?.includes('querySelectorAll("input:not([type])')) {
      return { filled: true, reason: "filled-choice", control: { count: 1 } } as T;
    }
    if (!this.started && !this.reviewingPreviousAttempt) {
      return {
        title: "Quiz",
        url: this.url,
        body_text: "Test versuchen",
        questions: [],
      } as T;
    }
    return {
      title: "Minitest",
      url: "https://moodle.example/mod/quiz/attempt.php?attempt=1&cmid=123",
      body_text: "Frage 1 Was ist 2+2?",
      questions: [
        {
          question_id: "question-1",
          question_index: 1,
          question_type: "multichoice",
          prompt: "Was ist 2+2?",
          options: ["3", "4"],
          controls: [
            { type: "radio", id: "q1-a", option_text: "3" },
            { type: "radio", id: "q1-b", option_text: "4" },
          ],
          visible_context: "Frage 1 Was ist 2+2? 3 4",
        },
      ],
    } as T;
  }

  async fill(): Promise<AgentBrowserCommandResult> {
    throw new Error("selector-not-found");
  }

  async click(selector: string): Promise<AgentBrowserCommandResult> {
    this.calls.push(`click:${selector}`);
    if (selector === "@e-review") {
      this.reviewingPreviousAttempt = true;
      this.url = "https://moodle.example/mod/quiz/review.php?attempt=1&cmid=123";
      return ok();
    }
    this.started = true;
    return ok();
  }

  async press(): Promise<AgentBrowserCommandResult> {
    return ok();
  }

  async wait(ms: number): Promise<AgentBrowserCommandResult> {
    this.calls.push(`wait:${ms}`);
    return ok();
  }

  async download(): Promise<AgentBrowserCommandResult> {
    return ok();
  }

  async close(): Promise<AgentBrowserCommandResult> {
    this.calls.push("close");
    return ok();
  }
}

class InvalidQuizExtractionClient extends FakeQuizBrowserClient {
  override async evalJson<T = unknown>(script?: string): Promise<T> {
    if (script?.includes("QUIZ_METADATA_EXTRACTION")) {
      return super.evalJson<T>(script);
    }
    return "not-an-object" as T;
  }
}

class FakeQuizDiscoveryClient implements AgentBrowserClient {
  readonly calls: string[] = [];
  private url = "https://moodle.example/my/";

  constructor(private readonly empty = false) {}

  async doctor() {
    return ok();
  }
  async open(url: string) {
    this.url = url;
    this.calls.push(`open:${url}`);
    return ok();
  }
  async snapshot(): Promise<AgentBrowserSnapshot> {
    if (this.empty) {
      return { origin: this.url, refs: {}, snapshot: "" };
    }
    if (this.url.includes("course/view.php")) {
      return {
        origin: this.url,
        refs: {
          q1: {
            role: "link",
            name: "Selbstcheck 1",
            href: "https://moodle.example/mod/quiz/view.php?id=101",
          },
          q2: {
            role: "link",
            name: "Selbstcheck 2",
            href: "https://moodle.example/mod/quiz/view.php?id=102",
          },
          t12generic: {
            role: "link",
            name: "Test",
            href: "https://moodle.example/mod/quiz/view.php?id=201",
          },
          t12: {
            role: "link",
            name: "Test zu 1. und 2. Einheit",
            href: "https://moodle.example/mod/quiz/view.php?id=201",
          },
          t8generic: {
            role: "link",
            name: "Test",
            href: "https://moodle.example/mod/quiz/view.php?id=208",
          },
          t8: {
            role: "link",
            name: "Test zu 8. Einheit",
            href: "https://moodle.example/mod/quiz/view.php?id=208",
          },
        },
        snapshot:
          '- link "Selbstcheck 1" [ref=q1]\n' +
          '- link "Selbstcheck 2" [ref=q2]\n' +
          '- link "Test" [ref=t12generic]\n' +
          '- link "Test zu 1. und 2. Einheit" [ref=t12]\n' +
          '- link "Test" [ref=t8generic]\n' +
          '- link "Test zu 8. Einheit" [ref=t8]',
      };
    }
    return {
      origin: this.url,
      refs: {
        et2: {
          role: "link",
          name: "ET2-DE/165657",
          href: "https://moodle.example/course/view.php?id=32897",
        },
      },
      snapshot: '- link "ET2-DE/165657" [ref=et2]',
    };
  }
  async getText() {
    return "";
  }
  async getTitle() {
    return "";
  }
  async getUrl() {
    return this.url;
  }
  async evalJson<T>() {
    return {} as T;
  }
  async fill() {
    return ok();
  }
  async click() {
    return ok();
  }
  async press() {
    return ok();
  }
  async wait() {
    return ok();
  }
  async download() {
    return ok();
  }
  async close() {
    return ok();
  }
}

function testConfig(
  runDir: string,
  quizSafetyPolicy: QuizSafetyPolicy = conservativeQuizPolicy(),
): MoodleRuntimeConfig {
  return {
    prompt: "mach den kommenden Minitest https://moodle.example/mod/quiz/view.php?id=123",
    originalUserPrompt: "mach den kommenden Minitest https://moodle.example/mod/quiz/view.php?id=123",
    outputLanguage: "de",
    outputLanguageReason: "prompt_language",
    moodleUrl: "https://moodle.example/my",
    outputPath: path.join(runDir, "document.typ"),
    runDir,
    maxDepth: 1,
    maxPages: 4,
    maxCisPages: 0,
    allowFileDownloads: false,
    baseUrl: "https://moodle.example",
    dashboardUrl: "https://moodle.example/my",
    username: "student",
    password: "secret",
    cisUrls: [],
    cisBaseUrl: "https://cis.example",
    cisDashboardUrl: "https://cis.example",
    headless: true,
    browserBackend: "agent-browser",
    autoAnswer: true,
    quizSafetyPolicy,
  };
}

function conservativeQuizPolicy(): QuizSafetyPolicy {
  return {
    accessMode: "review-only",
    allowOpeningQuizPages: true,
    allowStartingOrContinuingAttempts: false,
    minimumTimeLimitMinutes: 10,
    minimumAttemptsLeft: 2,
    allowReadingQuestions: true,
    allowSuggestingAnswers: false,
    allowFillingAnswers: false,
    allowChangingExistingAnswers: false,
    allowSavingMovingNext: false,
    askBeforeStartingOrContinuingAttempts: true,
    askBeforeTimedQuizzes: true,
    askBeforeLimitedAttemptQuizzes: true,
    askBeforeFillingAnswers: true,
    askBeforeChangingExistingAnswers: true,
    fillConfidenceThreshold: 0.85,
    finalSubmissionBlocked: true,
  };
}

function allowQuizWorkPolicy(): QuizSafetyPolicy {
  return {
    ...conservativeQuizPolicy(),
    allowStartingOrContinuingAttempts: true,
    askBeforeStartingOrContinuingAttempts: false,
    allowSuggestingAnswers: true,
    allowFillingAnswers: true,
    askBeforeTimedQuizzes: false,
    askBeforeLimitedAttemptQuizzes: false,
    askBeforeFillingAnswers: false,
  };
}

function ok(): AgentBrowserCommandResult {
  return { stdout: "", stderr: "" };
}

function openQuizMetadata(): Partial<QuizMetadata> {
  return {
    timeLimitMinutes: 120,
    attemptsAllowed: 3,
    attemptsUsed: 1,
    attemptsLeft: 2,
    hasActiveAttempt: false,
    canStartNewAttempt: true,
    availabilityStatus: "open",
    opensAt: null,
    closesAt: null,
    availabilityEvidence: ["enabled-start-control"],
    appearsTimed: true,
    appearsLimitedAttempt: true,
  };
}

function closedQuizMetadata(): Partial<QuizMetadata> {
  return {
    ...openQuizMetadata(),
    canStartNewAttempt: false,
    availabilityStatus: "closed",
    availabilityEvidence: ["closed-state-text"],
  };
}

function quizWorkflowState() {
  return {
    ...initialAgentState,
    extracted_data: {
      quiz_workflow: {
        kind: "quiz_workflow",
        target_url: "https://moodle.example/mod/quiz/view.php?id=123",
        page_number: 1,
        started: false,
        done: false,
        fill_results: [],
        risks: [],
        final_submit_clicked: false,
      },
    },
  };
}
