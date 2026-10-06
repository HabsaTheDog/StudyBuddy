import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeDirectQuiz, type DirectQuizDependencies } from "../directQuiz.js";
import { normalizeQuizMetadata } from "../interactive/quizSafetyPolicy.js";
import type { AgentBrowserClient } from "../interactive/agentBrowserClient.js";
import type { QuizPageExtraction } from "../interactive/nodes/quizReviewNode.js";
import {
  reserveFirstQuizAttempt,
  consumeFirstQuizStartRequest,
  loadFirstQuizStartRedirect,
} from "../interactive/quizAttemptGuard.js";

const target = "https://university.example/mod/quiz/view.php?id=7";
const attempt = "https://university.example/mod/quiz/attempt.php?attempt=123&page=0";
const summary = "https://university.example/mod/quiz/summary.php?attempt=123";
let workspace: string, env: NodeJS.ProcessEnv;
let currentUrl: string, domValue: string, serverValue: string, active: boolean;
let metadata: ReturnType<typeof normalizeQuizMetadata>;
let deps: DirectQuizDependencies;
let requests: Array<{ url: string; method: string }>;
let guard: (request: {
  url: string;
  method: string;
  postData: string | null;
  redirectedFrom?: { url: string; method: string; status?: number };
}) => void | Promise<void>;
let operations: { starts: number; fills: number; saves: number; closes: number };
const answer = {
  question_id: "question-1-1",
  confidence: 0.95,
  citations: ["Visible question: 2+2"],
  control_answers: [{ control_id: "answer-1", answer: "4", selected: false }],
};
function page(): QuizPageExtraction {
  return {
    title: "Actual quiz",
    url: currentUrl,
    body_text: "Time remaining changes",
    questions: currentUrl.includes("/attempt.php")
      ? [
          {
            question_id: "question-1-1",
            question_index: 1,
            question_type: "shortanswer",
            prompt: "2+2?",
            options: [],
            visible_context: "Actual question",
            controls: [
              {
                control_id: "answer-1",
                id: "answer-1",
                tag: "input",
                type: "text",
                value: domValue,
                disabled: false,
              },
            ],
            response_model: { support: "native", kind: "text" } as any,
          },
        ]
      : [],
  };
}
beforeEach(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), "direct-quiz-test-"));
  env = {
    STUDY_BUDDY_BROKER_EXECUTION: "1",
    STUDY_BUDDY_WORKSPACE: workspace,
    STUDY_BUDDY_DOCUMENT_OWNER_THREAD_ID: "owner-a",
    STUDY_BUDDY_WORKSPACE_KIND: "project",
    MOODLE_BASE_URL: "https://university.example",
    MOODLE_USERNAME: "account",
    MOODLE_PASSWORD: "secret",
    MOODLE_QUIZ_ACCESS_MODE: "quiz-assist",
    STUDY_BUDDY_QUIZ_ATTEMPT_LEDGER_ROOT: path.join(workspace, "ledger"),
  };
  currentUrl = target;
  domValue = "";
  serverValue = "";
  active = false;
  requests = [];
  metadata = normalizeQuizMetadata({
    availabilityStatus: "open",
    attemptsUsed: 0,
    attemptsAllowed: 3,
    canStartNewAttempt: true,
  });
  operations = { starts: 0, fills: 0, saves: 0, closes: 0 };
  const client = {
    setQuizRequestGuard: (value: typeof guard) => {
      guard = value;
    },
    secureLogin: async () => {},
    open: async (url: string) => {
      await guard({ url, method: "GET", postData: null });
      requests.push({ url, method: "GET" });
      currentUrl = url;
      domValue = serverValue;
      return { stdout: "", stderr: "" };
    },
    getUrl: async () => currentUrl,
    getTitle: async () => "Actual native quiz",
    captureQuestionEvidence: async () => ({
      images: [],
      errors: [],
      complete: true,
      expectedImageCount: 0,
      capturedImageCount: 0,
    }),
    close: async () => {
      operations.closes++;
      return { stdout: "", stderr: "" };
    },
  } as unknown as AgentBrowserClient;
  deps = {
    browser: () => client,
    metadata: async () => ({
      ...metadata,
      ...(active
        ? {
            hasActiveAttempt: true,
            attemptsUsed: 1,
            activeAttemptNumber: 1,
            activeAttemptId: "123",
            canStartNewAttempt: false,
          }
        : {}),
    }),
    extract: async () => structuredClone(page()),
    navigation: async () => "single-page",
    start: async () => {
      operations.starts++;
      const url = "https://university.example/mod/quiz/startattempt.php";
      await guard({ url, method: "POST", postData: "cmid=7&sesskey=token" });
      await guard({
        url: attempt,
        method: "GET",
        postData: null,
        redirectedFrom: { url, method: "POST", status: 303 },
      });
      currentUrl = attempt;
      active = true;
      return { clicked: true, started: true };
    },
    fill: async () => {
      operations.fills++;
      domValue = "4";
      return { filled: true };
    },
    next: async () => {
      operations.saves++;
      serverValue = domValue;
      currentUrl = summary;
      return { clicked: true, kind: "attempt_summary" };
    },
  };
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(workspace, { recursive: true, force: true });
});
async function start() {
  const inspected = await executeDirectQuiz({ op: "inspect", url: target }, env, deps);
  return executeDirectQuiz({ op: "start", runDir: inspected.runDir }, env, deps);
}
describe("direct deterministic quiz owner tools", () => {
  it("refuses reported answer risks despite high confidence without reflecting arbitrary risk text", async () => {
    const started = await start();
    const result = await executeDirectQuiz({
      op: "fill", runDir: started.runDir, packetDigest: started.packetDigest,
      answers: [{...answer, confidence: 0.98, risk_flags: ["answer-changing-ambiguity", "private-risk-canary"]}],
    }, env, deps);
    expect(result).toMatchObject({
      ok: false, status: "needs_clarification", error: "answer-risk-flags-present",
      blocked_questions: [{question_id: answer.question_id, risk_flag_count: 2}],
      persisted: false, safeNextClicked: false, finalSubmitClicked: false,
    });
    expect(result.next_action).toBe("Resolve the reported answer risks from supporting sources or an explicit user decision before filling this page.");
    expect(JSON.stringify(result)).not.toContain("private-risk-canary");
    expect(operations).toMatchObject({starts: 1, fills: 0, saves: 0});
  });

  it("refuses a mixed-page unresolved answer before changing any resolved question", async () => {
    const original = deps.extract!;
    deps.extract = async client => {
      const extracted = await original(client);
      if (extracted.questions.length) {
        const second = structuredClone(extracted.questions[0]);
        second.question_id = "question-1-2";
        second.question_index = 2;
        second.controls[0] = {...second.controls[0], id: "answer-2", control_id: "answer-2"};
        extracted.questions.push(second);
      }
      return extracted;
    };
    const started = await start();
    const result = await executeDirectQuiz({
      op: "fill", runDir: started.runDir, packetDigest: started.packetDigest,
      answers: [answer, {...answer, question_id: "question-1-2", confidence: 0.99,
        risk_flags: ["unresolved-assumption"],
        control_answers: [{control_id: "answer-2", answer: "4", selected: false}]}],
    }, env, deps);
    expect(result).toMatchObject({ok:false, status:"needs_clarification",
      blocked_questions:[{question_id:"question-1-2", risk_flag_count:1}],
      persisted:false, safeNextClicked:false, finalSubmitClicked:false});
    expect(operations).toMatchObject({fills:0, saves:0});
    await expect(executeDirectQuiz({op:"next", runDir:started.runDir}, env, deps))
      .rejects.toThrow("verified after");
  });

  it("allows a source-resolved qualification without guessing risk from its wording", async () => {
    const started = await start();
    const result = await executeDirectQuiz({op:"fill", runDir:started.runDir,
      packetDigest:started.packetDigest, answers:[{...answer, confidence:0.98,
        risk_flags:[], rationale:"The stated assumption is resolved by the referenced definition; the formerly ambiguous alternatives give the same answer under that explicit definition."}]}, env, deps);
    expect(result).toMatchObject({ok:true, persisted:true});
    expect(operations).toMatchObject({fills:1,saves:1});
  });

  it("labels persisted and complete checks as response persistence even for a mathematically wrong submitted answer", async () => {
    const started = await start();
    const wrong = {...answer, control_answers:[{control_id:"answer-1",answer:"5",selected:false}]};
    deps.fill = async (_client, _question, plan) => {
      operations.fills++;
      domValue = plan.control_answers![0].answer;
      return {filled:true};
    };
    const filled = await executeDirectQuiz({op:"fill",runDir:started.runDir,
      packetDigest:started.packetDigest,answers:[wrong]},env,deps);
    expect(filled).toMatchObject({ok:true,persisted:true,checks:[{verified:true}],
      verification_scope:"response_persistence",answer_correctness:"not_assessed"});
    const completed = await executeDirectQuiz({op:"complete",runDir:started.runDir},env,deps);
    expect(completed).toMatchObject({ok:true,progress:{verified:1,complete:true},
      verification_scope:"response_persistence",answer_correctness:"not_assessed",finalSubmitClicked:false});
    expect(serverValue).toBe("5");
    expect(operations).toMatchObject({starts:1,fills:1,saves:1});
  });

  it.each(["layout", "response-value", "response-selected"])(
    "normalizes immutable drag geometry before filling but binds concurrent %s state", async (change) => {
      let changed = false;
      const original = deps.extract!;
      deps.extract = async (client) => {
        const result = await original(client);
        const question = result.questions[0];
        question.question_type = "ddimageortext";
        question.controls[0] = {...question.controls[0], type:"dragdrop",
          value: changed && change === "response-value" ? "unexpected-current-answer" : domValue,
          bounds:{x:changed ? 250.5 : 250,y:100,width:50,height:30},
          target_geometry:{left:250,top:100,width:50,height:30,
            transform:[1,0,0,1,0,0],transform_origin:[0,0]},
          options:[{value:"4",text:"four",reusable:false,
            image_src:"https://university.example/original.png",
            selected:changed && change === "response-selected",
            bounds:{x:changed ? 20.5 : 20,y:220,width:50,height:30}}],
        };
        question.response_model={adapter:"drag-drop-image",support:"supported",
          questionType:"ddimageortext",controlCount:1,controlTypes:["dragdrop"],
          reason:"complete-native-control-surface"};
        return result;
      };
      const current = await start();
      changed = true;
      const invoke = () => executeDirectQuiz({op:"fill",runDir:current.runDir,
        packetDigest:current.packetDigest,answers:[answer]},env,deps);
      if (change === "layout") {
        expect(await invoke()).toMatchObject({ok:true,persisted:true});
        expect(operations).toMatchObject({fills:1,saves:1});
      } else {
        await expect(invoke()).rejects.toThrow("stale");
        expect(operations).toMatchObject({fills:0,saves:0});
      }
    },
  );
  it.each(["transient-recovers", "transient-persists", "unknown", "policy", "http403", "changed-bytes"])(
    "bounds fresh original-media retry without relaxing identity for %s", async (scenario) => {
      let fresh = false, initialCaptures = 0, preFillCaptures = 0;
      const client = deps.browser!({} as any);
      const valid = (changed = false) => ({images:[{path:"original.png", url:"https://university.example/original.png",
        sha256:changed ? "changed-original" : "original-sha", mimeType:"image/png"}],
        errors:[], complete:true, expectedImageCount:1, capturedImageCount:1});
      deps.browser = () => ({...client, captureQuestionEvidence: async () => {
        if (!fresh) { initialCaptures++; return valid(); }
        if (operations.fills > 0) return valid();
        preFillCaptures++;
        if (scenario === "changed-bytes") return valid(true);
        if (scenario === "transient-recovers" && preFillCaptures > 1) return valid();
        const code = scenario === "unknown" ? "unknown-backend-failure"
          : scenario === "policy" ? "image-1:image-origin-not-allowed"
          : scenario === "http403" ? "image-1:image-http-403" : "question-screenshot-failed";
        return {images:[],errors:[code],complete:false,expectedImageCount:1,capturedImageCount:0};
      }} as AgentBrowserClient);
      const current = await start();
      expect(initialCaptures).toBe(1);
      fresh = true;
      const invoke = () => executeDirectQuiz({op:"fill", runDir:current.runDir,
        packetDigest:current.packetDigest, answers:[answer]}, env, deps);
      if (scenario === "changed-bytes") {
        await expect(invoke()).rejects.toThrow("stale");
        expect(preFillCaptures).toBe(1);
        expect(operations).toMatchObject({fills:0,saves:0});
      } else if (scenario === "transient-recovers") {
        expect(await invoke()).toMatchObject({ok:true,persisted:true});
        expect(preFillCaptures).toBe(2);
        expect(operations).toMatchObject({fills:1,saves:1});
      } else {
        expect(await invoke()).toMatchObject({ok:false,status:"manual_action_required",finalSubmitClicked:false});
        expect(preFillCaptures).toBe(scenario === "transient-persists" ? 3 : 1);
        expect(operations).toMatchObject({fills:0,saves:0});
      }
    },
  );
  it("blocks a fresh media failure and exposes only sanitized diagnostic codes and readiness fields", async () => {
    let failed = false;
    const canary = "https://private.example/image?token=DO_NOT_EXPOSE";
    const client = deps.browser!({} as any);
    deps.browser = () => ({...client, captureQuestionEvidence: async () => failed ? {
      images:[], errors:["question-render-readiness-timeout", canary], complete:false,
      expectedImageCount:2, capturedImageCount:1,
      readinessDiagnostics:{incompleteImages:1, incompletePlaceholders:0,
        fontsLoading:false, mathJaxHub:true, questionMath:true, internalSource:canary},
    } : {images:[], errors:[], complete:true, expectedImageCount:0, capturedImageCount:0}} as AgentBrowserClient);
    const current = await start();
    failed = true;
    const result = await executeDirectQuiz({op:"fill", runDir:current.runDir,
      packetDigest:current.packetDigest, answers:[answer]}, env, deps);
    expect(result).toMatchObject({ok:false, status:"manual_action_required", finalSubmitClicked:false,
      media_diagnostics:[{question_id:"question-1-1", complete:false,
        errors:["question-render-readiness-timeout", "original-image-capture-failed"],
        expected_images:2, captured_images:1,
        readiness:{incompleteImages:1,incompletePlaceholders:0,fontsLoading:false,mathJaxHub:true,questionMath:true}}]});
    expect(JSON.stringify(result)).not.toContain(canary);
    expect(JSON.stringify(result)).not.toContain("internalSource");
    expect(operations).toMatchObject({starts:1, fills:0, saves:0});
  });
  it("keeps original-media identity when response clones change acquisition order, but rejects changed bytes", async () => {
    let reversed = false;
    let changed = false;
    const base = deps.browser!( {} as any );
    deps.browser = () => ({ ...base, captureQuestionEvidence: async () => {
      const images = [
        {path: "original-a.png", url: "https://university.example/a.png", sha256: "a", mimeType: "image/png"},
        {path: "original-b.png", url: "https://university.example/b.png", sha256: changed ? "changed-b" : "b", mimeType: "image/png"},
      ];
      return { images: reversed ? images.reverse() : images, errors: [], complete: true, expectedImageCount: 2, capturedImageCount: 2 };
    }} as AgentBrowserClient);
    const started = await start();
    reversed = true;
    const filled = await executeDirectQuiz({op: "fill", runDir: started.runDir, packetDigest: started.packetDigest, answers: [answer]}, env, deps);
    expect(filled).toMatchObject({ok: true, persisted: true, progress: {verified: 1}});
    changed = true;
    const complete = await executeDirectQuiz({op: "complete", runDir: started.runDir}, env, deps);
    expect(complete).toMatchObject({ok: false, progress: {verified: 0, complete: false}});
    expect(operations).toMatchObject({starts: 1, saves: 1});
  });
  it.each(["layout", "geometry", "choice", "fallback"])(
    "binds declared drag target geometry and conservatively handles %s changes", async (mutation) => {
      const original = deps.extract!;
      deps.extract = async (client) => {
        const result = await original(client);
        const question = result.questions[0];
        question.question_type = "ddimageortext";
        question.controls[0] = {
          ...question.controls[0], type: "dragdrop",
          bounds: {x: domValue ? 250.5 : 250, y:100, width:50, height:30},
          target_geometry: mutation === "fallback" ? null : {
            left:250, top:100, width: mutation === "geometry" && domValue ? 51 : 50,
            height:30, transform:[1,0,0,1,0,0], transform_origin:[0,0],
          },
          options:[{value:"4", text:"four", reusable:false,
            image_src: mutation === "choice" && domValue
              ? "https://university.example/changed.png" : "https://university.example/original.png",
            bounds:{x:domValue ? 250 : 20, y:domValue ? 100 : 220, width:50, height:30}}],
        };
        question.response_model = {adapter:"drag-drop-image", support:"supported",
          questionType:"ddimageortext", controlCount:1, controlTypes:["dragdrop"],
          reason:"complete-native-control-surface"};
        return result;
      };
      const current = await start();
      const filled = await executeDirectQuiz({op:"fill", runDir:current.runDir,
        packetDigest:current.packetDigest, answers:[answer]}, env, deps);
      if (mutation === "layout") {
        expect(filled).toMatchObject({ok:true, persisted:true});
        expect(operations.saves).toBe(1);
      } else {
        expect(filled).toMatchObject({ok:false, status:"dom_verification_failed", safeNextClicked:false});
        expect(operations.saves).toBe(0);
      }
    },
  );
  it("verifies saved drag placement while retaining target and choice identity", async () => {
    const original = deps.extract!;
    deps.extract = async (client) => {
      const result = await original(client);
      const question = result.questions[0];
      question.question_type = "ddimageortext";
      question.controls[0] = {
        ...question.controls[0],
        type: "dragdrop",
        bounds: { x: 250, y: 100, width: 50, height: 30 },
        options: [
          {
            value: "4",
            text: "four",
            reusable: false,
            bounds: { x: domValue ? 250 : 20, y: domValue ? 100 : 220, width: 50, height: 30 },
          },
        ],
      };
      question.response_model = {
        adapter: "drag-drop-image",
        support: "supported",
        questionType: "ddimageortext",
        controlCount: 1,
        controlTypes: ["dragdrop"],
        reason: "complete-native-control-surface",
      };
      return result;
    };
    const current = await start();
    const result = await executeDirectQuiz(
      { op: "fill", runDir: current.runDir, packetDigest: current.packetDigest, answers: [answer] },
      env,
      deps,
    );
    expect(result).toMatchObject({ ok: true, persisted: true });
    expect(operations).toMatchObject({ fills: 1, saves: 1 });
  });

  it("revalidates an API-recovered legacy attempt without a start receipt on fresh read and fill", async () => {
    const config = {
      ledgerRoot: env.STUDY_BUDDY_QUIZ_ATTEMPT_LEDGER_ROOT!,
      targetUrl: target,
      accountKey: createHash("sha256").update(env.MOODLE_USERNAME!).digest("hex"),
    };
    await reserveFirstQuizAttempt(config, metadata);
    await consumeFirstQuizStartRequest(config);
    active = true;
    deps.metadata = async () => ({
      ...metadata,
      hasActiveAttempt: true,
      attemptsUsed: 1,
      activeAttemptId: null,
      activeAttemptNumber: null,
      canStartNewAttempt: false,
      identityEvidence: {
        currentAttemptId: null,
        continuation: [],
        history: [{ ordinal: 1, attemptId: null, source: "history-card" }],
      },
    });
    const browser = deps.browser!;
    deps.browser = (runtime) => ({
      ...browser(runtime),
      evalJson: async <T>(expression: string): Promise<T> => {
        if (expression.includes("globalThis.M")) return 42 as T;
        if (expression.includes(".qnbutton")) return [{ slot: "1", number: 1, page: 0 }] as T;
        if (expression.includes("document.body.cloneNode")) {
          const current = page();
          return {
            shared: current.body_text,
            questions: current.questions.map((question) => ({
              id: question.question_id,
              html: question.prompt,
              prompt: question.prompt,
              context: question.visible_context,
              controls: [],
            })),
          } as T;
        }
        throw Error("Unexpected local DOM fixture query.");
      },
    });
    let reads = 0;
    let available = true;
    deps.readIdentity = async () => {
      reads++;
      return available
        ? {
            ok: true,
            identityEvidence: {
              source: "moodle-mobile-read-api",
              courseId: 42,
              courseModuleId: 7,
              quizId: 27,
              userId: 17,
              attemptId: "123",
              attemptNumber: 1,
              state: "inprogress",
              preview: false,
            },
          }
        : { ok: false, error: "read-api-service-unavailable" };
    };
    const inspected = await executeDirectQuiz({ op: "inspect", url: target }, env, deps);
    await executeDirectQuiz({ op: "recover", runDir: inspected.runDir }, env, deps);
    const current = await executeDirectQuiz({ op: "read", runDir: inspected.runDir }, env, deps);
    expect(
      await executeDirectQuiz(
        {
          op: "fill",
          runDir: inspected.runDir,
          packetDigest: current.packetDigest,
          answers: [answer],
        },
        env,
        deps,
      ),
    ).toMatchObject({ ok: true, persisted: true });
    expect(reads).toBe(4);
    expect(operations).toMatchObject({ starts: 0, saves: 1 });
    expect(await loadFirstQuizStartRedirect(config)).toBeNull();
    available = false;
    await expect(
      executeDirectQuiz({ op: "read", runDir: inspected.runDir }, env, deps),
    ).rejects.toThrow();
    expect(operations).toMatchObject({ starts: 0, saves: 1 });
  });
  it("keeps shared originals ahead of screenshots with Windows path separators", async () => {
    deps.extract = async () => {
      const captured = structuredClone(page());
      return {
        ...captured,
        descriptions: [
          {
            ...captured.questions[0],
            question_id: "question-1-99",
            question_type: "description",
            controls: [],
          },
        ],
      };
    };
    const browser = deps.browser!;
    deps.browser = (config) => ({
      ...browser(config),
      captureQuestionEvidence: async (questionID) => ({
        images:
          questionID === "question-1-99"
            ? [
                {
                  path: "C:\\context\\original.png",
                  url: "https://university.example/original.png",
                  mimeType: "image/png",
                  sha256: "original-sha",
                },
              ]
            : [],
        screenshotPath:
          questionID === "question-1-99" ? "C:\\context\\question.png" : "C:\\packet\\question.png",
        errors: [],
        complete: true,
      }),
    });
    const started = await start();
    const packet = JSON.parse(
      await readFile((started.packets as Array<{ packetPath: string }>)[0].packetPath, "utf8"),
    );
    expect(packet.image_paths).toEqual([
      "C:\\context\\original.png",
      "C:\\packet\\question.png",
      "C:\\context\\question.png",
    ]);
  });
  it("binds immutable radio choice values and rejects changed encoding before any response write", async () => {
    let choice = "original-choice";
    deps.extract = async () => {
      const captured = structuredClone(page());
      for (const question of captured.questions) {
        question.controls[0] = {
          ...question.controls[0],
          type: "radio",
          value: choice,
          checked: false,
        };
        question.prompt_html = `<input type="radio" value="${choice}">`;
      }
      return captured;
    };
    const started = await start();
    choice = "different-choice";
    await expect(
      executeDirectQuiz(
        {
          op: "fill",
          runDir: started.runDir,
          packetDigest: started.packetDigest,
          answers: [answer],
        },
        env,
        deps,
      ),
    ).rejects.toThrow("stale");
    expect(operations).toMatchObject({ fills: 0, saves: 0 });
  });
  it("does not collect hidden sequential pages or treat current-page capture as the whole attempt", async () => {
    deps.navigation = async () => "unknown";
    deps.inventory = async () => ({
      confirmed: true,
      questions: [
        { key: "slot:1", slot: "1", number: 1, page: 0 },
        { key: "slot:2", slot: "2", number: 2, page: 1 },
      ],
      pages: [0, 1],
    });
    const started = await start();
    const collected = await executeDirectQuiz({ op: "collect", runDir: started.runDir }, env, deps);
    expect(collected).toMatchObject({
      ok: false,
      status: "manual_action_required",
      progress: { total: 2, captured: 1, captureComplete: false, complete: false },
    });
    expect(requests.some((request) => request.url.includes("page=1"))).toBe(false);
    expect(operations).toMatchObject({ starts: 1, fills: 0, saves: 0 });
  });

  it("refuses stable missing-original media before writing any answer", async () => {
    const browser = deps.browser!;
    deps.browser = (config) => ({
      ...browser(config),
      captureQuestionEvidence: async () => ({
        images: [],
        errors: ["image-1:image-http-404"],
        complete: false,
        expectedImageCount: 1,
        capturedImageCount: 0,
      }),
    });
    const started = await start();
    const result = await executeDirectQuiz(
      { op: "fill", runDir: started.runDir, packetDigest: started.packetDigest, answers: [answer] },
      env,
      deps,
    );
    expect(result).toMatchObject({
      ok: false,
      status: "manual_action_required",
      blocked_questions: ["question-1-1"],
      progress: { complete: false },
    });
    expect(operations).toMatchObject({ fills: 0, saves: 0 });
  });

  it("binds original HTML even when image alt text and extracted prose stay unchanged", async () => {
    let html = '<img src="/source-a.png" alt="diagram">';
    deps.extract = async () => {
      const value = page();
      value.questions.forEach((question) => {
        question.prompt_html = html;
      });
      return value;
    };
    const started = await start();
    html = '<img src="/source-b.png" alt="diagram">';
    await expect(
      executeDirectQuiz(
        {
          op: "fill",
          runDir: started.runDir,
          packetDigest: started.packetDigest,
          answers: [answer],
        },
        env,
        deps,
      ),
    ).rejects.toThrow("stale");
    expect(operations).toMatchObject({ fills: 0, saves: 0 });
  });

  it("rejects a disappearing question before safe-next instead of accepting vacuous verification", async () => {
    deps.extract = async () => {
      const value = page();
      if (operations.fills) value.questions = [];
      return value;
    };
    const started = await start();
    const result = await executeDirectQuiz(
      { op: "fill", runDir: started.runDir, packetDigest: started.packetDigest, answers: [answer] },
      env,
      deps,
    );
    expect(result).toMatchObject({
      ok: false,
      status: "dom_verification_failed",
      safeNextClicked: false,
      finalSubmitClicked: false,
      error: "DOM answer verification failed; safe-next was not clicked.",
      diagnostics: {
        same_question_set: false,
        questions: [
          {
            question_index: 1,
            present: false,
            identity_matches: false,
            answers_verified: false,
            mismatch_codes: ["question-missing-after-fill"],
          },
        ],
      },
    });
    expect(operations).toMatchObject({ fills: 1, saves: 0 });
  });

  it("separates changed task fields from correctly filled responses without exposing their contents", async () => {
    deps.extract = async () => {
      const value = page();
      if (operations.fills) value.questions[0]!.prompt = "secret-task-canary";
      return value;
    };
    const started = await start();
    const result = await executeDirectQuiz(
      { op: "fill", runDir: started.runDir, packetDigest: started.packetDigest, answers: [answer] },
      env,
      deps,
    );
    expect(result).toMatchObject({
      ok: false,
      status: "dom_verification_failed",
      safeNextClicked: false,
      finalSubmitClicked: false,
      diagnostics: {
        same_question_set: false,
        questions: [
          {
            question_index: 1,
            present: true,
            identity_matches: false,
            changed_fields: ["prompt"],
            answers_verified: true,
            mismatch_codes: [],
            control_indices: [],
          },
        ],
        fill_results: [{ filled: true }],
      },
    });
    expect(JSON.stringify(result)).not.toContain("secret-task-canary");
    expect(operations).toMatchObject({ fills: 1, saves: 0 });
  });

  it("separates an unchanged task with mismatching responses and sanitizes arbitrary fill failure text", async () => {
    deps.fill = async () => {
      operations.fills++;
      domValue = "secret-response-canary";
      return { filled: false, reason: "secret-session-canary" };
    };
    const started = await start();
    const result = await executeDirectQuiz(
      { op: "fill", runDir: started.runDir, packetDigest: started.packetDigest, answers: [answer] },
      env,
      deps,
    );
    expect(result).toMatchObject({
      ok: false,
      status: "dom_verification_failed",
      safeNextClicked: false,
      finalSubmitClicked: false,
      diagnostics: {
        same_question_set: true,
        questions: [
          {
            question_index: 1,
            present: true,
            identity_matches: true,
            changed_fields: [],
            answers_verified: false,
            mismatch_codes: ["control-response-mismatch"],
            control_indices: [0],
          },
        ],
        fill_results: [{ filled: false, reason: "unrecognized-fill-reason" }],
      },
    });
    expect(JSON.stringify(result)).not.toContain("secret-response-canary");
    expect(JSON.stringify(result)).not.toContain("secret-session-canary");
    expect(operations).toMatchObject({ fills: 1, saves: 0 });
  });

  it("inspects metadata without starting, solving, or capturing an attempt", async () => {
    const result = await executeDirectQuiz(
      { op: "inspect", url: target, prompt: "Inspect exact quiz" },
      env,
      deps,
    );
    expect(result).toMatchObject({
      ok: true,
      title: "Actual native quiz",
      untrusted: true,
      metadata: { attemptsUsed: 0 },
    });
    expect(operations).toEqual({ starts: 0, fills: 0, saves: 0, closes: 1 });
    expect(requests).toEqual([{ url: target, method: "GET" }]);
  });
  it("starts only the first attempt and exposes packets; fills provided native answers, saves and verifies after fresh reload", async () => {
    const started = await start();
    expect(started).toMatchObject({
      ok: true,
      attemptUrl: attempt,
      packets: [{ question_id: "question-1-1" }],
    });
    const packet = JSON.parse(await readFile((started.packets as any[])[0].packetPath, "utf8"));
    expect(packet.question.prompt).toBe("2+2?");
    const filled = await executeDirectQuiz(
      { op: "fill", runDir: started.runDir, packetDigest: started.packetDigest, answers: [answer] },
      env,
      deps,
    );
    expect(filled).toMatchObject({
      ok: true,
      persisted: true,
      checks: [{ verified: true }],
      finalSubmitClicked: false,
    });
    expect(operations).toMatchObject({ starts: 1, fills: 1, saves: 1 });
    const next = await executeDirectQuiz({ op: "next", runDir: started.runDir }, env, deps);
    expect(next).toMatchObject({ ok: true, status: "summary", attemptUrl: summary });
    expect(operations.starts).toBe(1);
  });
  it("resumes exact bound attempt after a new invocation without ever clicking start again", async () => {
    const first = await start();
    const recovered = await executeDirectQuiz({ op: "recover", runDir: first.runDir }, env, deps);
    expect(recovered.attemptUrl).toBe(attempt);
    expect(operations.starts).toBe(1);
    await executeDirectQuiz({ op: "start", runDir: first.runDir }, env, deps);
    expect(operations.starts).toBe(1);
  });
  it("rejects a replacement start after lost first response; reservation survives failure", async () => {
    const inspected = await executeDirectQuiz({ op: "inspect", url: target }, env, deps);
    deps.start = async () => {
      operations.starts++;
      throw Error("connection lost");
    };
    await expect(
      executeDirectQuiz({ op: "start", runDir: inspected.runDir }, env, deps),
    ).rejects.toThrow("connection lost");
    await expect(
      executeDirectQuiz({ op: "start", runDir: inspected.runDir }, env, deps),
    ).rejects.toThrow("already reserved");
    expect(operations.starts).toBe(1);
  });
  it("recovers a positively identified active first attempt after losing its start response without a second POST", async () => {
    const inspected = await executeDirectQuiz({ op: "inspect", url: target }, env, deps);
    const realStart = deps.start!;
    deps.start = async (client, options) => {
      await realStart(client, options);
      throw Error("response lost");
    };
    await expect(
      executeDirectQuiz({ op: "start", runDir: inspected.runDir }, env, deps),
    ).rejects.toThrow("response lost");
    expect(
      (await executeDirectQuiz({ op: "recover", runDir: inspected.runDir }, env, deps)).ok,
    ).toBe(true);
    expect(operations.starts).toBe(1);
  });
  it("requires actual overview ordinal and rejects a concurrent external second-attempt identity", async () => {
    const inspected = await executeDirectQuiz({ op: "inspect", url: target }, env, deps);
    const meta = deps.metadata!;
    deps.metadata = async (client) => ({
      ...(await meta(client)),
      ...(active ? { attemptsUsed: 2, activeAttemptNumber: 2, activeAttemptId: "123" } : {}),
    });
    await expect(
      executeDirectQuiz({ op: "start", runDir: inspected.runDir }, env, deps),
    ).rejects.toThrow("exact active first attempt");
    await expect(
      executeDirectQuiz({ op: "recover", runDir: inspected.runDir }, env, deps),
    ).rejects.toThrow("active-identity-unconfirmed");
    expect(operations.starts).toBe(1);
  });
  it("recovers a dead process lock, while active and initializing locks remain blocked", async () => {
    const started = await start(),
      file = path.join(started.runDir as string, ".operation-lock");
    await writeFile(file, JSON.stringify({ version: 1, pid: process.pid, token: randomUUID() }));
    await expect(
      executeDirectQuiz({ op: "recover", runDir: started.runDir }, env, deps),
    ).rejects.toThrow("Another operation");
    await writeFile(file, "");
    await expect(
      executeDirectQuiz({ op: "recover", runDir: started.runDir }, env, deps),
    ).rejects.toThrow("Another operation");
    const dead = await promisify(execFile)(process.execPath, [
      "-e",
      "process.stdout.write(String(process.pid))",
    ]);
    await writeFile(
      file,
      JSON.stringify({ version: 1, pid: Number(dead.stdout), token: randomUUID() }),
    );
    expect((await executeDirectQuiz({ op: "recover", runDir: started.runDir }, env, deps)).ok).toBe(
      true,
    );
    expect(operations.starts).toBe(1);
  });
  it("requires broker approval rather than accepting a pending request path as self-approval", async () => {
    env.MOODLE_QUIZ_ACCESS_MODE = "ask-before-attempt";
    const inspected = await executeDirectQuiz({ op: "inspect", url: target }, env, deps);
    expect(inspected.permissionRequestPath).toBeTruthy();
    await expect(
      executeDirectQuiz(
        {
          op: "start",
          runDir: inspected.runDir,
          permissionRequestPath: inspected.permissionRequestPath,
        },
        env,
        deps,
      ),
    ).rejects.toThrow("broker has not approved");
    const pending = JSON.parse(await readFile(inspected.permissionRequestPath as string, "utf8"));
    env.STUDY_BUDDY_QUIZ_APPROVED_REQUEST_IDS = JSON.stringify([pending.requestId]);
    const started = await executeDirectQuiz(
      {
        op: "start",
        runDir: inspected.runDir,
        permissionRequestPath: inspected.permissionRequestPath,
      },
      env,
      deps,
    );
    expect(started.ok).toBe(true);
    await expect(
      executeDirectQuiz({ op: "read", runDir: started.runDir }, env, deps),
    ).rejects.toThrow("permission_required");
    expect(
      (
        await executeDirectQuiz(
          {
            op: "read",
            runDir: started.runDir,
            permissionRequestPath: inspected.permissionRequestPath,
          },
          env,
          deps,
        )
      ).ok,
    ).toBe(true);
  });
  it("never broadens Review Only with an approved request", async () => {
    env.MOODLE_QUIZ_ACCESS_MODE = "ask-before-attempt";
    const inspected = await executeDirectQuiz({ op: "inspect", url: target }, env, deps);
    const pending = JSON.parse(await readFile(inspected.permissionRequestPath as string, "utf8"));
    env.STUDY_BUDDY_QUIZ_APPROVED_REQUEST_IDS = JSON.stringify([pending.requestId]);
    env.MOODLE_QUIZ_ACCESS_MODE = "review-only";
    await expect(
      executeDirectQuiz(
        {
          op: "start",
          runDir: inspected.runDir,
          permissionRequestPath: inspected.permissionRequestPath,
        },
        env,
        deps,
      ),
    ).rejects.toThrow("Review-only");
    expect(operations.starts).toBe(0);
  });
  it.each([
    "https://other.example/mod/quiz/view.php?id=7",
    target + "&sesskey=x",
    "https://university.example/mod/quiz/startattempt.php",
    attempt,
  ])("rejects unsafe inspect target %s before browser launch", async (url) => {
    const browser = vi.fn(deps.browser);
    deps.browser = browser;
    await expect(executeDirectQuiz({ op: "inspect", url }, env, deps)).rejects.toThrow();
    expect(browser).not.toHaveBeenCalled();
  });
  it("rejects stale packet and incomplete controls before mutating the page", async () => {
    const started = await start();
    await expect(
      executeDirectQuiz(
        { op: "fill", runDir: started.runDir, packetDigest: "stale", answers: [answer] },
        env,
        deps,
      ),
    ).rejects.toThrow("stale");
    await expect(
      executeDirectQuiz(
        {
          op: "fill",
          runDir: started.runDir,
          packetDigest: started.packetDigest,
          answers: [
            {
              ...answer,
              control_answers: [{ ...answer.control_answers[0], control_id: "foreign" }],
            },
          ],
        },
        env,
        deps,
      ),
    ).rejects.toThrow("exact current");
    expect(operations.fills).toBe(0);
  });
  it("does not claim persistence when saved responses disappear after reload", async () => {
    const started = await start();
    deps.next = async () => {
      operations.saves++;
      currentUrl = summary;
      return { clicked: true, kind: "attempt_summary" };
    };
    const result = await executeDirectQuiz(
      { op: "fill", runDir: started.runDir, packetDigest: started.packetDigest, answers: [answer] },
      env,
      deps,
    );
    expect(result).toMatchObject({ ok: false, persisted: false });
    await expect(
      executeDirectQuiz({ op: "next", runDir: started.runDir }, env, deps),
    ).rejects.toThrow("verified after");
  });
  it("never advances unknown/sequential navigation with empty or unverified answers", async () => {
    deps.navigation = async () => "unknown";
    const started = await start();
    const result = await executeDirectQuiz(
      { op: "fill", runDir: started.runDir, packetDigest: started.packetDigest, answers: [answer] },
      env,
      deps,
    );
    expect(result).toMatchObject({ ok: false, status: "manual_action_required" });
    expect(operations.fills).toBe(0);
    expect(operations.saves).toBe(0);
    await expect(
      executeDirectQuiz({ op: "next", runDir: started.runDir }, env, deps),
    ).rejects.toThrow("verified after");
    await expect(
      executeDirectQuiz({ op: "read", runDir: started.runDir, page: 1 }, env, deps),
    ).rejects.toThrow("arbitrary page");
  });
  it("rejects absent broker, foreign owner, run path escape and state symlink", async () => {
    await expect(
      executeDirectQuiz(
        { op: "inspect", url: target },
        { ...env, STUDY_BUDDY_BROKER_EXECUTION: "0" },
        deps,
      ),
    ).rejects.toThrow("broker");
    const inspected = await executeDirectQuiz({ op: "inspect", url: target }, env, deps);
    await expect(
      executeDirectQuiz(
        { op: "status", runDir: inspected.runDir },
        { ...env, STUDY_BUDDY_DOCUMENT_OWNER_THREAD_ID: "foreign" },
        deps,
      ),
    ).rejects.toThrow();
    await expect(executeDirectQuiz({ op: "status", runDir: workspace }, env, deps)).rejects.toThrow(
      "outside",
    );
    const file = path.join(inspected.runDir as string, "direct-quiz.json"),
      sentinel = path.join(workspace, "external.json");
    await writeFile(sentinel, "private-sentinel");
    await rm(file);
    await symlink(sentinel, file);
    await expect(
      executeDirectQuiz({ op: "status", runDir: inspected.runDir }, env, deps),
    ).rejects.toThrow("symlinks");
    expect(await readFile(sentinel, "utf8")).toBe("private-sentinel");
  });
  it("rejects injected policy/browser/eval fields and final-submit operations", async () => {
    for (const input of [
      { op: "inspect", url: target, policy: { allowStartingOrContinuingAttempts: true } },
      { op: "eval", script: "anything" },
      { op: "submit", runDir: workspace },
    ])
      await expect(executeDirectQuiz(input, env, deps)).rejects.toThrow();
    expect(operations.starts).toBe(0);
  });
});
