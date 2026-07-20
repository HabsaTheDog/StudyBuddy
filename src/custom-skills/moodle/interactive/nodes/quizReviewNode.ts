import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentBrowserClient } from "../agentBrowserClient.js";
import { createBrowserClient } from "../browserClient.js";
import { createBrowserLoginConfig, ensureAgentBrowserLoggedIn } from "../browserAuth.js";
import {
  browserRefSelector,
  extractLinksFromSnapshot,
  isFinalSubmitClickLabel,
  safeFileName,
} from "../browserSafety.js";
import type { CodexClient } from "../codexClient.js";
import { extractQuizUrl, promptWantsQuizAttempt } from "../quizIntent.js";
import {
  enforceQuizSafetyPolicy,
  extractQuizMetadata,
  type QuizMetadata,
  type QuizPolicyDecision,
} from "../quizSafetyPolicy.js";
import type { JsonObject, LangGraphAgentState } from "../state.js";
import type { MoodleRuntimeConfig } from "../types.js";
import {
  buildPendingQuizPermissionRequest,
  persistPendingQuizPermission,
} from "../quizPermissions.js";
import {
  classifyQuizQuestionResponse,
  type QuizQuestionResponseModel,
} from "../quizQuestionAdapters.js";

export interface QuizQuestion {
  question_id: string;
  question_index: number;
  question_type: string;
  prompt: string;
  prompt_latex?: string;
  prompt_html?: string;
  options: string[];
  controls: Array<Record<string, unknown>>;
  visible_context: string;
  question_classes?: string[];
  interaction_hints?: QuizInteractionHints;
  response_model?: QuizQuestionResponseModel;
}

export interface QuizInteractionHints {
  code_editors?: number;
  rich_text_editors?: number;
  drag_items?: number;
  drop_zones?: number;
  sortable_items?: number;
  canvases?: number;
  iframes?: number;
}

export interface QuizPageExtraction {
  title: string;
  url: string;
  body_text: string;
  questions: QuizQuestion[];
}

export interface QuizCandidate {
  title: string;
  url: string;
  sourceUrl: string;
  score: number;
  order: number;
}

export interface QuizPageNavigationResult {
  clicked: boolean;
  kind?: "next_page" | "attempt_summary";
  text?: string;
  ref?: string;
  reason?: string;
}

export interface AnswerSpec {
  question_id?: string;
  question_index?: number;
  answer?: unknown;
  answers?: unknown[];
  confidence?: number;
  citations?: string[];
  rationale?: string;
  risk_flags?: string[];
  control_answers?: AnswerControlSpec[];
}

export interface AnswerControlSpec {
  control_id: string;
  answer: string;
  selected: boolean;
}

export interface QuizReviewNodeDependencies {
  agentBrowser?: AgentBrowserClient;
  codex?: CodexClient;
}

const QUESTION_EXTRACTION_JS = String.raw`
(() => {
  const normalize = value => (value || "").replace(/\s+/g, " ").trim();
  const textOf = node => node ? (node.innerText || node.textContent || "") : "";
  const htmlOf = node => node ? (node.innerHTML || "") : "";
  const mathText = node => {
    if (!node) return "";
    const bits = [];
    for (const math of node.querySelectorAll("mjx-container, math, .MathJax, .MathJax_Display, script[type^='math/tex']")) {
      bits.push(
        math.getAttribute("aria-label") ||
        math.getAttribute("data-semantic-speech") ||
        math.getAttribute("alttext") ||
        math.textContent ||
        ""
      );
    }
    for (const img of node.querySelectorAll("img[alt], img[title]")) {
      bits.push(img.getAttribute("alt") || img.getAttribute("title") || "");
    }
    return normalize(bits.join(" "));
  };
  const optionLetter = text => {
    const match = normalize(text).match(/^([a-z])\s*[.)]/i);
    return match ? match[1].toLowerCase() : null;
  };
  const questionNodes = [...document.querySelectorAll(".que, [id^='question-']")];
  const questions = questionNodes.map((node, index) => {
    const promptNode = node.querySelector(".qtext") || node;
    const visibleText = textOf(node).trim();
    const numberMatch = visibleText.match(/(?:Frage|Question)\s+(\d+)/i);
    const questionNumber = numberMatch ? Number(numberMatch[1]) : index + 1;
    const controls = [...node.querySelectorAll("input, textarea, select")]
      .filter(el => !["hidden", "submit", "button"].includes((el.type || "").toLowerCase()))
      .map((el, controlIndex) => {
        const labels = [...(el.labels || [])].map(label => textOf(label).trim()).filter(Boolean);
        const optionContainer = el.closest("label, .r0, .r1, .answer div, p, li");
        const optionText = labels[0] || textOf(optionContainer).trim();
        const optionHtml = htmlOf(optionContainer);
        const optionMath = mathText(optionContainer || el);
        return {
          control_index: controlIndex,
          control_id: el.id || null,
          tag: el.tagName.toLowerCase(),
          type: (el.type || el.tagName).toLowerCase(),
          id: el.id || null,
          name: el.name || null,
          aria_label: el.getAttribute("aria-label") || null,
          value: el.value || "",
          checked: Boolean(el.checked),
          disabled: Boolean(el.disabled),
          option_text: optionText,
          letter: optionLetter(optionText),
          latex: optionMath,
          options: el.tagName.toLowerCase() === "select"
            ? [...el.options].map(option => ({
                value: option.value || "",
                text: textOf(option).trim(),
                selected: Boolean(option.selected),
                disabled: Boolean(option.disabled)
              }))
            : [],
          raw_html: optionHtml
        };
      });
    const options = controls
      .filter(control => ["radio", "checkbox"].includes(control.type))
      .map(control => control.option_text)
      .filter(Boolean);
    return {
      question_id: node.id || "question-" + (index + 1),
      question_index: questionNumber,
      question_type: [...node.classList].find(c => c !== "que") || "unknown",
      question_classes: [...node.classList],
      prompt: textOf(promptNode).trim(),
      prompt_latex: mathText(promptNode),
      prompt_html: htmlOf(promptNode),
      options: [...new Set(options)].slice(0, 20),
      controls,
      interaction_hints: {
        code_editors: node.querySelectorAll(".CodeMirror, .monaco-editor, .ace_editor, [data-coderunner]").length,
        rich_text_editors: node.querySelectorAll(".tox-tinymce, [contenteditable='true']").length,
        drag_items: node.querySelectorAll(".drag, .draghome, [draggable='true']").length,
        drop_zones: node.querySelectorAll(".dropzone, [data-drop-zone]").length,
        sortable_items: node.querySelectorAll(".sortablelist li, [data-sortable-item]").length,
        canvases: node.querySelectorAll("canvas, svg[role='application']").length,
        iframes: node.querySelectorAll("iframe").length
      },
      visible_context: visibleText
    };
  });
  return JSON.stringify({
    title: document.title,
    url: location.href,
    body_text: textOf(document.body),
    questions
  });
})()
`;

const SUBAGENT_ANSWER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    question_id: { type: ["string", "null"] },
    question_index: { type: ["number", "null"] },
    answer: { type: "string" },
    answers: { type: "array", items: { type: "string" } },
    confidence: { type: "number" },
    citations: { type: "array", items: { type: "string" } },
    rationale: { type: "string" },
    risk_flags: { type: "array", items: { type: "string" } },
    control_answers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          control_id: { type: "string" },
          answer: { type: "string" },
          selected: { type: "boolean" },
        },
        required: ["control_id", "answer", "selected"],
      },
    },
  },
  required: [
    "question_id",
    "question_index",
    "answer",
    "answers",
    "confidence",
    "citations",
    "rationale",
    "risk_flags",
    "control_answers",
  ],
} as const;

export function createQuizReviewNode(
  config: MoodleRuntimeConfig,
  dependencies: QuizReviewNodeDependencies = {},
) {
  return async function quizReviewNode(
    state: LangGraphAgentState,
  ): Promise<Partial<LangGraphAgentState>> {
    const client = dependencies.agentBrowser ?? createBrowserClient(config);
    try {
      await ensureAgentBrowserLoggedIn(
        client,
        createBrowserLoginConfig({
          serviceName: "Moodle",
          targetUrl: config.moodleUrl || config.dashboardUrl,
          username: config.username,
          password: config.password,
          allowedOrigins: config.moodleLoginAllowedOrigins,
        }),
      );

      const target = extractQuizUrl(config.prompt) ?? (await discoverQuizTarget(config, client));
      if (!target) {
        const report = buildNoQuizReport(config.prompt);
        await persistQuizArtifacts(config, {
          report,
          questions: [],
          candidates: [],
          targetUrl: null,
          finalSubmitClicked: false,
        });
        return {
          final_document: report,
          extracted_data: toJsonObject({
            kind: "quiz_review",
            status: "no_quiz_target",
            questions: [],
          }),
          source_coverage: {
            ...state.source_coverage,
            moodle: {
              status: "empty",
              detail: "No Moodle quiz target was found for the prompt.",
              urls: [config.moodleUrl],
              pages: 1,
            },
          },
          error_log: null,
        };
      }

      const openDecision = enforceQuizSafetyPolicy(config.quizSafetyPolicy, "open_quiz_page");
      if (openDecision.status !== "allowed") {
        return await stopForQuizPolicy(config, state, target, openDecision);
      }

      await client.open(target);
      await client.wait(1_000);
      let metadata = await extractQuizMetadata(client);
      const readDecision = enforceQuizSafetyPolicy(config.quizSafetyPolicy, "read_questions");
      if (readDecision.status !== "allowed") {
        return await stopForQuizPolicy(config, state, target, readDecision, metadata);
      }

      const wantsAttempt = promptWantsQuizAttempt(config.prompt);
      let beforeStart = await extractQuizPage(client);
      let startDecision = wantsAttempt
        ? enforceQuizSafetyPolicy(config.quizSafetyPolicy, "start_or_continue_attempt", {
            metadata,
          })
        : null;
      if (
        startDecision?.status &&
        startDecision.status !== "allowed" &&
        beforeStart.questions.length === 0 &&
        isTerminalQuizAvailabilityDecision(startDecision)
      ) {
        return await stopForQuizPolicy(config, state, target, startDecision, metadata);
      }
      if (beforeStart.questions.length === 0) {
        const reviewResult = await openSafePreviousAttemptReview(client);
        if (reviewResult.clicked) {
          await client.wait(1_500);
          beforeStart = await extractQuizPage(client);
        }
      }
      startDecision = wantsAttempt
        ? enforceQuizSafetyPolicy(config.quizSafetyPolicy, "start_or_continue_attempt", {
            metadata,
          })
        : null;
      if (
        startDecision?.status &&
        startDecision.status !== "allowed" &&
        beforeStart.questions.length === 0
      ) {
        return await stopForQuizPolicy(config, state, target, startDecision, metadata);
      }
      if (wantsAttempt && beforeStart.questions.length === 0) {
        metadata = await extractQuizMetadata(client);
        const liveStartDecision = enforceQuizSafetyPolicy(
          config.quizSafetyPolicy,
          "start_or_continue_attempt",
          { metadata },
        );
        if (liveStartDecision.status !== "allowed") {
          return await stopForQuizPolicy(config, state, target, liveStartDecision, metadata);
        }
      }
      const startResult =
        wantsAttempt && beforeStart.questions.length === 0
          ? await clickSafeStartOrContinue(client)
          : { clicked: false, reason: "not-requested-or-questions-visible" };
      if (startResult.clicked) {
        await client.wait(1_500);
      }
      const fillResults = config.autoAnswer
        ? await autoAnswerVisibleQuiz(config, client, dependencies.codex)
        : [];
      const page = await extractQuizPage(client);
      const risks = detectQuizRisks(page.body_text);
      const report = buildQuizReviewReport({
        page,
        target,
        startResult,
        metadata,
        risks,
        fillResults,
      });
      await persistQuizArtifacts(config, {
        report,
        questions: page.questions,
        candidates: [],
        targetUrl: page.url || target,
        finalSubmitClicked: false,
        startResult,
        metadata,
        risks,
        fillResults,
      });

      return {
        moodle_raw_text: formatQuizRawText(page),
        final_document: report,
        extracted_data: toJsonObject({
          kind: "quiz_review",
          status: page.questions.length ? "questions_visible" : "no_questions_visible",
          target_url: page.url || target,
          questions: page.questions,
          start_result: startResult,
          quiz_metadata: metadata,
          fill_results: fillResults,
          risks,
          final_submit_clicked: false,
        }),
        source_coverage: {
          ...state.source_coverage,
          moodle: {
            status: "success",
            detail: `Reviewed Moodle quiz with ${page.questions.length} visible question(s).`,
            urls: [page.url || target],
            pages: 1,
          },
        },
        error_log: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        final_document: `= Moodle Quiz Review\n\nFehler: ${message}\n\nFinal submit was not clicked.\n`,
        error_log: message,
      };
    } finally {
      if (!config.keepBrowserOpen) {
        await client.close().catch(() => undefined);
      }
    }
  };
}

export async function autoAnswerVisibleQuiz(
  config: MoodleRuntimeConfig,
  client: AgentBrowserClient,
  codex: CodexClient | undefined,
): Promise<Array<Record<string, unknown>>> {
  if (!codex) {
    return [{ action: "auto_answer", filled: false, reason: "codex-client-unavailable" }];
  }
  const allResults: Array<Record<string, unknown>> = [];
  const packetRoot = path.join(config.runDir, "subagent-packets");
  await mkdir(packetRoot, { recursive: true });

  for (let pageNumber = 1; pageNumber <= Math.max(1, config.maxPages); pageNumber += 1) {
    const readDecision = enforceQuizSafetyPolicy(config.quizSafetyPolicy, "read_questions");
    if (readDecision.status !== "allowed") {
      allResults.push(policyDecisionResult(readDecision, pageNumber));
      break;
    }
    const page = await extractQuizPage(client);
    if (!page.questions.length) {
      allResults.push({ page_number: pageNumber, action: "extract", questions: 0 });
      break;
    }
    const pageDir = path.join(packetRoot, `page-${String(pageNumber).padStart(3, "0")}`);
    await mkdir(pageDir, { recursive: true });
    const pageResults: Array<Record<string, unknown>> = [];

    for (const question of page.questions) {
      const packetPath = path.join(
        pageDir,
        `question-${String(question.question_index).padStart(3, "0")}.json`,
      );
      const packet = buildQuestionPacket({ page, question, pageNumber });
      await writeFile(packetPath, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
      const suggestionDecision = enforceQuizSafetyPolicy(
        config.quizSafetyPolicy,
        "suggest_answers",
      );
      if (suggestionDecision.status !== "allowed") {
        pageResults.push({
          ...policyDecisionResult(suggestionDecision, pageNumber),
          question_id: question.question_id,
          question_index: question.question_index,
        });
        continue;
      }
      const answer = await generateAnswerSpec(codex, packet);
      await writeFile(
        path.join(path.dirname(packetPath), "answer-spec.json"),
        `${JSON.stringify(answer, null, 2)}\n`,
        "utf8",
      );
      const result = await fillVisibleQuestion(client, question, answer, config.quizSafetyPolicy);
      pageResults.push({ ...result, page_number: pageNumber });
    }
    const nextDecision = enforceQuizSafetyPolicy(config.quizSafetyPolicy, "save_or_next_page");
    if (nextDecision.status !== "allowed") {
      allResults.push(...markPageFillPersistence(pageResults, false));
      allResults.push(policyDecisionResult(nextDecision, pageNumber));
      break;
    }
    const nextResult = await clickSafeNextPage(client);
    allResults.push(...markPageFillPersistence(pageResults, nextResult.clicked));
    allResults.push({ page_number: pageNumber, action: "navigation", ...nextResult });
    if (!nextResult.clicked) {
      break;
    }
    if (nextResult.kind === "attempt_summary" || pageNumber >= Math.max(1, config.maxPages)) {
      break;
    }
    await client.wait(1_000);
  }

  return allResults;
}

export function buildQuestionPacket(input: {
  page: QuizPageExtraction;
  question: QuizQuestion;
  pageNumber: number;
}): Record<string, unknown> {
  return {
    captured_at: new Date().toISOString(),
    page_number: input.pageNumber,
    title: input.page.title,
    url: input.page.url,
    question: input.question,
    page_body_excerpt: input.page.body_text.slice(0, 6000),
    instructions: [
      "Return only the answer JSON matching the schema.",
      "Use citations from the visible Moodle question/options or known course source text in this packet.",
      "When controls expose control_id values, return one control_answers entry for every editable control.",
      "For text, number, and select controls, put the exact answer or exact visible select-option text in answer and set selected=false.",
      "For every radio or checkbox control, copy its control_id and option text into answer and set selected=true only for each correct option.",
      "Never collapse a multi-field Cloze question into one answer and never collapse a multiple-response checkbox question into one option.",
      "If unsure, set confidence below 0.65 or add a risk flag so the orchestrator leaves the answer unchanged.",
    ],
  };
}

export async function generateAnswerSpec(
  codex: CodexClient,
  packet: Record<string, unknown>,
): Promise<AnswerSpec> {
  const prompt = [
    "Answer this Moodle quiz question for a study assistant.",
    "Return strict JSON with answer/answers, confidence, citations, rationale, and risk_flags.",
    "Also return a complete control_answers plan keyed by the exact control_id values from the packet.",
    "Write learner-facing rationale and risk explanations in the packet's output_language.",
    "Do not invent unsupported answers. If insufficiently sourced, use confidence 0.",
    "",
    JSON.stringify(packet, null, 2),
  ].join("\n");
  let firstError: unknown;
  for (const attempt of [1, 2]) {
    try {
      const raw = await codex.run(prompt, {
        outputSchema: SUBAGENT_ANSWER_SCHEMA,
        task: "quiz_solver",
        attempt,
      });
      return normalizeAnswerSpec(JSON.parse(stripJsonFence(raw)));
    } catch (error) {
      if (attempt === 1) {
        firstError = error;
        continue;
      }
      throw new Error("Quiz Solver failed with both its primary and retry policies.", {
        cause: error,
      });
    }
  }
  throw new Error("Quiz Solver failed without producing an answer.", { cause: firstError });
}

function normalizeAnswerSpec(value: unknown): AnswerSpec {
  const answer = (value && typeof value === "object" ? value : {}) as AnswerSpec;
  const normalized: AnswerSpec = {
    answer: answer.answer,
    answers: Array.isArray(answer.answers) ? answer.answers : [],
    confidence: Number(answer.confidence ?? 0),
    citations: Array.isArray(answer.citations) ? answer.citations.map(String) : [],
    rationale: String(answer.rationale ?? ""),
    risk_flags: Array.isArray(answer.risk_flags) ? answer.risk_flags.map(String) : [],
    control_answers: Array.isArray(answer.control_answers)
      ? answer.control_answers.flatMap((entry) => {
          if (!entry || typeof entry !== "object") return [];
          const candidate = entry as Partial<AnswerControlSpec>;
          if (typeof candidate.control_id !== "string" || !candidate.control_id.trim()) return [];
          return [
            {
              control_id: candidate.control_id,
              answer: String(candidate.answer ?? ""),
              selected: candidate.selected === true,
            },
          ];
        })
      : [],
  };
  if (answer.question_id !== undefined && answer.question_id !== null) {
    normalized.question_id = answer.question_id;
  }
  if (answer.question_index !== undefined && answer.question_index !== null) {
    normalized.question_index = answer.question_index;
  }
  return normalized;
}

function stripJsonFence(value: string): string {
  return value
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

export async function fillVisibleQuestion(
  client: AgentBrowserClient,
  question: QuizQuestion,
  answer: AnswerSpec,
  policy?: MoodleRuntimeConfig["quizSafetyPolicy"],
): Promise<Record<string, unknown>> {
  if (policy) {
    const fillDecision = enforceQuizSafetyPolicy(policy, "fill_answers", { question, answer });
    if (fillDecision.status !== "allowed") {
      return {
        question_id: question.question_id,
        question_index: question.question_index,
        filled: false,
        answer,
        ...policyDecisionResult(fillDecision),
      };
    }
  }
  if (question.response_model?.support === "no_response") {
    return {
      question_id: question.question_id,
      question_index: question.question_index,
      filled: false,
      reason: "question-has-no-response",
      response_model: question.response_model,
    };
  }
  if (question.response_model?.support === "adapter_required") {
    return {
      question_id: question.question_id,
      question_index: question.question_index,
      filled: false,
      reason: "question-adapter-required",
      response_model: question.response_model,
      answer,
    };
  }
  const validationError = validateAnswerSpec(answer, policy?.fillConfidenceThreshold ?? 0.65);
  if (validationError) {
    return {
      question_id: question.question_id,
      question_index: question.question_index,
      filled: false,
      reason: validationError,
      answer,
    };
  }
  const result = await client.evalJson<Record<string, unknown>>(
    buildFillQuestionJs(question, answer),
  );
  return {
    question_id: question.question_id,
    question_index: question.question_index,
    answer,
    ...result,
  };
}

function validateAnswerSpec(answer: AnswerSpec, confidenceThreshold: number): string | null {
  if (
    answer.answer === undefined &&
    (!answer.answers || answer.answers.length === 0) &&
    (!answer.control_answers || answer.control_answers.length === 0)
  ) {
    return "answer-missing";
  }
  if (Number(answer.confidence ?? 0) < confidenceThreshold) {
    return "confidence-below-threshold";
  }
  if (!answer.citations?.length) {
    return "citations-missing";
  }
  if (answer.risk_flags?.length) {
    return "answer-risk-flags-present";
  }
  return null;
}

function answerValues(answer: AnswerSpec): unknown[] {
  if (typeof answer.answer === "string") {
    const controlIds = answer.answer
      .split(/[;,]/)
      .map((value) => value.trim())
      .filter((value) => /^[^\s;,]+_choice\d+$/i.test(value));
    if (controlIds.length > 0) {
      return controlIds;
    }
  }
  if (answer.answers?.length) {
    return answer.answers;
  }
  return [answer.answer];
}

function buildFillQuestionJs(question: QuizQuestion, answer: AnswerSpec): string {
  return String.raw`
(() => {
  const question = document.getElementById(${JSON.stringify(question.question_id)});
  const answer = ${JSON.stringify(answerValues(answer))};
  const controlPlan = ${JSON.stringify(answer.control_answers ?? [])};
  if (!question) return JSON.stringify({ filled: false, reason: "question-not-found" });
  const rawValues = Array.isArray(answer) ? answer : [answer];
  const values = rawValues.map(value => typeof value === "object" && value !== null ? value : { text: String(value) });
  const normalize = value => String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
  const compact = value => normalize(value).replace(/\s+/g, "");
  const letterOf = value => {
    const match = normalize(value).match(/^([a-z])(?:\s*[.)]|\s*$)/);
    return match ? match[1] : "";
  };
  const equivalent = (expectedRaw, optionRaw) => {
    const expected = normalize(expectedRaw);
    const option = normalize(optionRaw);
    return Boolean(expected && option && (option === expected || compact(option) === compact(expected)));
  };
  if (controlPlan.length) {
    const editableControls = [...question.querySelectorAll("input, textarea, select")]
      .filter(control => !control.disabled && !control.readOnly && !["hidden", "submit", "button"].includes((control.type || "").toLowerCase()));
    const plannedIds = new Set(controlPlan.map(spec => String(spec.control_id || "")));
    const missingIds = editableControls
      .filter(control => !control.id || !plannedIds.has(control.id))
      .map(control => control.id || control.name || control.tagName.toLowerCase());
    if (missingIds.length || plannedIds.size !== controlPlan.length) {
      return JSON.stringify({ filled: false, reason: "control-plan-incomplete", control: { missing: missingIds } });
    }
    const operations = [];
    const unresolved = [];
    for (const spec of controlPlan) {
      const control = document.getElementById(String(spec.control_id || ""));
      if (!control || !question.contains(control) || control.disabled || control.readOnly) {
        unresolved.push({ control_id: spec.control_id, reason: "control-not-editable" });
        continue;
      }
      const type = (control.type || control.tagName).toLowerCase();
      if (type === "checkbox" || type === "radio") {
        operations.push({ kind: "choice", control, selected: spec.selected === true });
        continue;
      }
      if (control.tagName.toLowerCase() === "select") {
        const option = [...control.options].find(candidate =>
          equivalent(spec.answer, candidate.text || "") || normalize(candidate.value || "") === normalize(spec.answer)
        );
        if (!option || option.disabled) {
          unresolved.push({ control_id: spec.control_id, reason: "select-option-not-found", answer: spec.answer });
        } else {
          operations.push({ kind: "select", control, value: option.value });
        }
        continue;
      }
      if (["text", "number", "textarea"].includes(type)) {
        if (!String(spec.answer || "").trim()) {
          unresolved.push({ control_id: spec.control_id, reason: "text-answer-empty" });
        } else {
          operations.push({ kind: "text", control, value: String(spec.answer) });
        }
        continue;
      }
      unresolved.push({ control_id: spec.control_id, reason: "unsupported-control-type", type });
    }
    const radioGroups = new Map();
    for (const operation of operations.filter(operation => operation.kind === "choice" && operation.control.type === "radio")) {
      const group = operation.control.name || operation.control.id;
      radioGroups.set(group, (radioGroups.get(group) || 0) + (operation.selected ? 1 : 0));
    }
    for (const [group, selectedCount] of radioGroups) {
      if (selectedCount !== 1) unresolved.push({ group, reason: "radio-selection-invalid", selected_count: selectedCount });
    }
    if (unresolved.length || operations.length !== editableControls.length) {
      return JSON.stringify({ filled: false, reason: "control-plan-invalid", control: { unresolved } });
    }
    for (const operation of operations) {
      const control = operation.control;
      control.focus();
      if (operation.kind === "choice") {
        if (control.checked !== operation.selected) {
          control.checked = operation.selected;
          control.dispatchEvent(new Event("input", { bubbles: true }));
          control.dispatchEvent(new Event("change", { bubbles: true }));
        }
      } else {
        control.value = operation.value;
        control.dispatchEvent(new Event("input", { bubbles: true }));
        control.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
    return JSON.stringify({
      filled: true,
      reason: "filled-control-plan",
      control: {
        count: operations.length,
        types: operations.reduce((counts, operation) => ({ ...counts, [operation.kind]: (counts[operation.kind] || 0) + 1 }), {})
      }
    });
  }
  const textControls = [...question.querySelectorAll("input:not([type]), input[type='text'], input[type='number'], textarea")]
    .filter(el => !el.disabled && !el.readOnly && el.type !== "hidden");
  if (textControls.length) {
    const filledControls = [];
    textControls.forEach((control, index) => {
      const value = values[index] ?? values[values.length - 1] ?? { text: "" };
      control.focus();
      control.value = String(value.text ?? value.value ?? "");
      control.dispatchEvent(new Event("input", { bubbles: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
      filledControls.push({ id: control.id || null, name: control.name || null });
    });
    return JSON.stringify({ filled: true, reason: "filled-text", control: { count: filledControls.length, matched: filledControls } });
  }

  const choiceControls = [...question.querySelectorAll("input[type='radio'], input[type='checkbox']")].filter(el => !el.disabled);
  const selectedControls = new Set();
  const matchedControls = [];
  for (const expectedSpec of values) {
    const expectedRaw = String(expectedSpec.text ?? expectedSpec.answer ?? expectedSpec.value ?? "");
    const expected = normalize(expectedRaw);
    const expectedLetter = normalize(String(expectedSpec.letter ?? "")) || letterOf(expected);
    const expectedControlId = String(expectedSpec.control_id ?? expectedSpec.id ?? "");
    let matched = null;
    let matchedBy = null;
    for (const control of choiceControls) {
      const labels = [...(control.labels || [])].map(label => label.innerText).join(" ");
      const container = control.closest("label, .r0, .r1, .answer div, p, li");
      const optionText = normalize(labels || (container ? container.innerText : "") || control.value || "");
      const optionLetter = letterOf(optionText);
      if (expectedControlId && control.id === expectedControlId) {
        matched = control;
        matchedBy = "control_id";
        break;
      }
      if (control.id && (expectedRaw === control.id || expectedRaw.startsWith(control.id + ":"))) {
        matched = control;
        matchedBy = "control_id_prefix";
        break;
      }
      if (expectedLetter && optionLetter && expectedLetter === optionLetter) {
        matched = control;
        matchedBy = "letter";
        break;
      }
      if (equivalent(expected, optionText) || equivalent(expected, control.value || "")) {
        matched = control;
        matchedBy = "text";
        break;
      }
    }
    if (matched) {
      if (!selectedControls.has(matched)) {
        selectedControls.add(matched);
        matchedControls.push({ id: matched.id || null, name: matched.name || null, matched_by: matchedBy });
      }
    }
  }
  if (selectedControls.size) {
    for (const control of choiceControls) {
      const shouldCheck = selectedControls.has(control);
      if (control.type === "checkbox" && control.checked !== shouldCheck) {
        control.checked = shouldCheck;
        control.dispatchEvent(new Event("input", { bubbles: true }));
        control.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (control.type === "radio" && shouldCheck && !control.checked) {
        control.checked = true;
        control.dispatchEvent(new Event("input", { bubbles: true }));
        control.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
    return JSON.stringify({ filled: true, reason: "filled-choice", control: { count: selectedControls.size, matched: matchedControls } });
  }

  const selects = [...question.querySelectorAll("select:not([disabled])")];
  const selectMatches = selects.map((select, index) => {
    const value = values[index] ?? values[values.length - 1] ?? { text: "" };
    const expected = normalize(String(value.text ?? value.value ?? ""));
    const option = [...select.options].find(opt => equivalent(expected, opt.text || "") || normalize(opt.value || "") === expected);
    return option ? { select, option } : null;
  });
  if (selects.length && selectMatches.every(Boolean)) {
    for (const match of selectMatches) {
      match.select.value = match.option.value;
      match.select.dispatchEvent(new Event("input", { bubbles: true }));
      match.select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return JSON.stringify({
      filled: true,
      reason: "filled-select",
      control: {
        count: selectMatches.length,
        matched: selectMatches.map(match => ({ id: match.select.id || null, name: match.select.name || null }))
      }
    });
  }
  return JSON.stringify({ filled: false, reason: "no-compatible-control-or-option-match" });
})()
`;
}

export async function clickSafeNextPage(
  client: AgentBrowserClient,
): Promise<QuizPageNavigationResult> {
  const snapshot = await client.snapshot({ interactive: true, compact: true });
  const candidate = snapshot.snapshot
    .split("\n")
    .map((line) => {
      const ref = /ref=([a-z0-9_-]+)/i.exec(line)?.[1];
      const details = ref ? snapshot.refs[ref] : undefined;
      return {
        ref,
        name: details?.name ?? /"([^"]+)"/.exec(line)?.[1] ?? "",
        role: details?.role ?? /^\s*([^\s"]+)/.exec(line)?.[1] ?? "",
      };
    })
    .filter(
      ({ name, ref, role }) =>
        Boolean(ref) &&
        /^(?:button|link)$/i.test(role) &&
        isSafeNextPageLabel(name) &&
        !isFinalSubmitClickLabel(name),
    )
    .sort(
      (left, right) =>
        navigationControlPriority(right.name) - navigationControlPriority(left.name),
    )[0];
  if (candidate?.ref) {
    await client.click(browserRefSelector(candidate.ref));
    return {
      clicked: true,
      kind: isAttemptSummaryLabel(candidate.name) ? "attempt_summary" : "next_page",
      text: candidate.name,
      ref: candidate.ref,
    };
  }
  return { clicked: false, reason: "no-safe-next-page" };
}

function isSafeNextPageLabel(label: string): boolean {
  const normalized = label.replace(/\s+/g, " ").trim();
  return (
    /^(?:nächste seite|naechste seite|next page|weiter|next|save and next|speichern und weiter)$/i.test(
      normalized,
    ) || isAttemptSummaryLabel(normalized)
  );
}

function isAttemptSummaryLabel(label: string): boolean {
  return /^(?:versuch beenden|versuch abschlie(?:ß|ss)en|finish attempt)(?:\s*(?:\.{3}|…))?$/i.test(
    label.replace(/\s+/g, " ").trim(),
  );
}

function navigationControlPriority(label: string): number {
  return isAttemptSummaryLabel(label) ? 0 : 1;
}

export function markPageFillPersistence(
  results: Array<Record<string, unknown>>,
  persisted: boolean,
): Array<Record<string, unknown>> {
  return results.map((result) => {
    if (result.filled !== true) return result;
    if (persisted) {
      return { ...result, dom_filled: true, persisted: true };
    }
    return {
      ...result,
      dom_filled: true,
      filled: false,
      persisted: false,
      fill_reason: result.reason,
      reason: "answer-not-persisted",
    };
  });
}

function toJsonObject(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

export async function discoverQuizTarget(
  config: MoodleRuntimeConfig,
  client: AgentBrowserClient,
): Promise<string | null> {
  const visited = new Set<string>();
  const queue: string[] = [config.moodleUrl || config.dashboardUrl];
  const candidatesByUrl = new Map<string, QuizCandidate>();
  const sourcesDir = path.join(config.runDir, "quiz-discovery-snapshots");
  await mkdir(sourcesDir, { recursive: true });

  while (queue.length && visited.size < Math.max(1, config.maxPages)) {
    const url = queue.shift();
    if (!url || visited.has(url)) {
      continue;
    }
    visited.add(url);
    await client.open(url);
    await client.wait(750);
    const snapshot = await client.snapshot({ interactive: true, urls: true, compact: true });
    await writeFile(
      path.join(sourcesDir, safeFileName(`${visited.size}-${url}.json`)),
      `${JSON.stringify(snapshot, null, 2)}\n`,
      "utf8",
    );
    const links = extractLinksFromSnapshot(snapshot.snapshot, snapshot.refs);
    for (const link of links) {
      if (!link.href.startsWith(config.baseUrl)) {
        continue;
      }
      if (isQuizActivityViewUrl(link.href)) {
        const canonicalUrl = canonicalQuizCandidateUrl(link.href);
        const existing = candidatesByUrl.get(canonicalUrl);
        if (!existing) {
          const order = candidatesByUrl.size;
          candidatesByUrl.set(canonicalUrl, {
            title: link.label,
            url: canonicalUrl,
            sourceUrl: url,
            score: 0,
            order,
          });
        } else if (
          quizCandidateTitleQuality(link.label) > quizCandidateTitleQuality(existing.title)
        ) {
          existing.title = link.label;
        }
      } else if (
        (link.href.includes("/course/view.php") || link.href.includes("/my/")) &&
        isRelevantCourseLink(config.prompt, link.label, link.href) &&
        !visited.has(link.href) &&
        queue.length + visited.size < config.maxPages
      ) {
        queue.push(link.href);
      }
    }
  }

  const candidates = [...candidatesByUrl.values()];
  for (const candidate of candidates) {
    candidate.score = scoreQuizCandidate(
      config.prompt,
      candidate.title,
      candidate.url,
      candidate.order,
    );
  }
  const selected = selectQuizCandidate(config.prompt, candidates);
  candidates.sort((a, b) => b.score - a.score || a.order - b.order);
  await writeFile(
    path.join(config.runDir, "quiz-candidates.json"),
    `${JSON.stringify(candidates, null, 2)}\n`,
    "utf8",
  );
  return selected?.url ?? null;
}

export async function extractQuizPage(client: AgentBrowserClient): Promise<QuizPageExtraction> {
  const value = await client.evalJson<unknown>(QUESTION_EXTRACTION_JS);
  if (!isRecord(value) || !Array.isArray(value.questions)) {
    throw new Error("Invalid Moodle quiz page extraction: expected an object with questions.");
  }
  if (
    typeof value.title !== "string" ||
    typeof value.url !== "string" ||
    typeof value.body_text !== "string"
  ) {
    throw new Error("Invalid Moodle quiz page extraction: missing page metadata.");
  }
  const questions = value.questions.map((question, index) => validateQuizQuestion(question, index));
  return {
    title: value.title,
    url: value.url,
    body_text: value.body_text,
    questions,
  };
}

function validateQuizQuestion(value: unknown, index: number): QuizQuestion {
  if (
    !isRecord(value) ||
    typeof value.question_id !== "string" ||
    typeof value.question_index !== "number" ||
    typeof value.question_type !== "string" ||
    typeof value.prompt !== "string" ||
    !Array.isArray(value.options) ||
    !value.options.every((option) => typeof option === "string") ||
    !Array.isArray(value.controls) ||
    !value.controls.every(isRecord) ||
    typeof value.visible_context !== "string"
  ) {
    throw new Error(`Invalid Moodle quiz page extraction: malformed question ${index + 1}.`);
  }
  const question = value as unknown as QuizQuestion;
  return {
    ...question,
    response_model: classifyQuizQuestionResponse(question),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function clickSafeStartOrContinue(
  client: AgentBrowserClient,
): Promise<{ clicked: boolean; text?: string; ref?: string; reason?: string }> {
  const snapshot = await client.snapshot({ interactive: true, compact: true });
  const startLine = snapshot.snapshot
    .split("\n")
    .map((line) => {
      const ref = /ref=([a-z0-9_-]+)/i.exec(line)?.[1];
      const details = ref ? snapshot.refs[ref] : undefined;
      const name = details?.name ?? /"([^"]+)"/.exec(line)?.[1] ?? "";
      const role = details?.role ?? /^\s*([^\s"]+)/.exec(line)?.[1] ?? "";
      return { line, ref, name, role };
    })
    .filter(
      ({ name, ref, role }) =>
        Boolean(ref) && /^(?:button|link)$/i.test(role) && isStartOrContinueLabel(name),
    )
    .sort((a, b) => startControlScore(b.name) - startControlScore(a.name))[0];
  if (!startLine?.ref) {
    return { clicked: false, reason: "no-safe-start-control" };
  }
  if (isFinalSubmitClickLabel(startLine.name)) {
    return { clicked: false, reason: "blocked-final-submit-like-control", text: startLine.name };
  }
  await client.click(browserRefSelector(startLine.ref));
  return { clicked: true, text: startLine.name, ref: startLine.ref };
}

export async function openSafePreviousAttemptReview(
  client: AgentBrowserClient,
): Promise<{ clicked: boolean; text?: string; ref?: string; reason?: string }> {
  const snapshot = await client.snapshot({ interactive: true, compact: true, urls: true });
  const candidate = snapshot.snapshot
    .split("\n")
    .map((line) => {
      const ref = /ref=([a-z0-9_-]+)/i.exec(line)?.[1];
      const name = snapshot.refs[ref ?? ""]?.name ?? /"([^"]+)"/.exec(line)?.[1] ?? "";
      const href = snapshot.refs[ref ?? ""]?.href ?? /url=([^\]\s,]+)/i.exec(line)?.[1] ?? "";
      return { ref, name, href };
    })
    .find(({ name, href }) =>
      Boolean(
        href &&
        /\/mod\/quiz\/review\.php\b/i.test(href) &&
        !isFinalSubmitClickLabel(name) &&
        !isStartOrContinueLabel(name),
      ),
    );
  if (!candidate?.ref) {
    return { clicked: false, reason: "no-safe-previous-attempt-review" };
  }
  await client.click(browserRefSelector(candidate.ref));
  return { clicked: true, text: candidate.name, ref: candidate.ref };
}

function isStartOrContinueLabel(label: string): boolean {
  return /test versuchen|test wiederholen|versuch beginnen|versuch fortsetzen|versuch wiederholen|attempt quiz|start attempt|continue attempt|re-attempt quiz|attempt again|repeat attempt/i.test(
    label,
  );
}

function isTerminalQuizAvailabilityDecision(decision: QuizPolicyDecision): boolean {
  return (
    decision.status === "blocked" &&
    /^(?:quiz-closed|quiz-not-yet-open|quiz-attempts-exhausted|quiz-unavailable|quiz-availability-unknown)$/.test(
      decision.reason,
    )
  );
}

function startControlScore(label: string): number {
  const normalized = label.replace(/\s+/g, " ").trim();
  const exact =
    /^(?:test versuchen|test wiederholen|versuch beginnen|versuch fortsetzen|versuch wiederholen|attempt quiz|start attempt|continue attempt|re-attempt quiz|attempt again|repeat attempt)$/i.test(
      normalized,
    );
  return (exact ? 1_000 : 0) - normalized.length;
}

function scoreQuizCandidate(prompt: string, title: string, url: string, index: number): number {
  const haystack = `${title} ${url}`.toLocaleLowerCase("de-AT");
  const terms = prompt.toLocaleLowerCase("de-AT").match(/[a-zA-ZäöüÄÖÜß0-9]{3,}/g) ?? [];
  let score = Math.max(0, 20 - index);
  for (const term of terms) {
    if (haystack.includes(term)) {
      score += term.length > 4 ? 5 : 2;
    }
  }
  if (/kommend|nächst|naechst|heutig|aktuell/.test(prompt.toLocaleLowerCase("de-AT"))) {
    score += Math.max(0, 15 - index);
  }
  if (
    /minitest|kurztest|moodle test/.test(prompt.toLocaleLowerCase("de-AT")) &&
    /minitest|kurztest|test/.test(haystack)
  ) {
    score += 12;
  }
  const intent = parseQuizTargetIntent(prompt);
  const candidateUnits = extractUnitNumbers(title);
  if (intent.requiredUnits.size > 0 && sameNumberSet(intent.requiredUnits, candidateUnits)) {
    score += 100;
  }
  const candidateOrdinal = requestedOrdinal(title);
  if (intent.ordinal !== null && candidateOrdinal !== null) {
    score += candidateOrdinal === intent.ordinal ? 100 : -1_000;
  }
  if ([...candidateUnits].some((unit) => intent.excludedUnits.has(unit))) {
    score -= 1_000;
  }
  return score;
}

function selectQuizCandidate(prompt: string, candidates: QuizCandidate[]): QuizCandidate | null {
  const intent = parseQuizTargetIntent(prompt);
  let matching = candidates.filter((candidate) => {
    const units = extractUnitNumbers(candidate.title);
    if ([...units].some((unit) => intent.excludedUnits.has(unit))) return false;
    if (intent.kind && classifyQuizCandidateKind(candidate.title) !== intent.kind) return false;
    if (intent.requiredUnits.size > 0 && !sameNumberSet(intent.requiredUnits, units)) return false;
    return true;
  });
  if (intent.requiredUnits.size > 0) {
    return matching.length === 1 ? matching[0] : null;
  }
  matching = matching.sort((a, b) => a.order - b.order);
  if (intent.ordinal !== null) {
    const explicitlyNumbered = matching.filter(
      (candidate) => requestedOrdinal(candidate.title) !== null,
    );
    if (explicitlyNumbered.length > 0) {
      const exact = explicitlyNumbered.filter(
        (candidate) => requestedOrdinal(candidate.title) === intent.ordinal,
      );
      return exact.length === 1 ? exact[0] : null;
    }
    return matching[intent.ordinal - 1] ?? null;
  }
  return [...matching].sort((a, b) => b.score - a.score || a.order - b.order)[0] ?? null;
}

type QuizCandidateKind = "test" | "selbstcheck" | "homework" | "minitest";

interface QuizTargetIntent {
  kind: QuizCandidateKind | null;
  requiredUnits: Set<number>;
  excludedUnits: Set<number>;
  ordinal: number | null;
}

function parseQuizTargetIntent(prompt: string): QuizTargetIntent {
  const lower = prompt.toLocaleLowerCase("de-AT");
  const negativeSegments = [...lower.matchAll(/\b(?:kein(?:e|en|er|es|em)?|nicht)\b[^;!?]*/gi)].map(
    (match) => match[0],
  );
  const positive = negativeSegments.reduce((value, segment) => value.replace(segment, " "), lower);
  const excludedUnits = new Set(
    negativeSegments.flatMap((segment) => [...extractUnitNumbers(segment)]),
  );
  const requiredUnits = extractUnitNumbers(positive);
  const kind = /\bselbstcheck\b/i.test(positive)
    ? "selbstcheck"
    : /\b(?:hausübung|hausuebung|homework)\b/i.test(positive)
      ? "homework"
      : /\b(?:minitest|kurztest)\b/i.test(positive)
        ? "minitest"
        : requiredUnits.size > 0 && /\b(?:test|quiz)\b/i.test(positive)
          ? "test"
          : null;
  return {
    kind,
    requiredUnits,
    excludedUnits,
    ordinal: requestedOrdinal(positive),
  };
}

function extractUnitNumbers(value: string): Set<number> {
  const output = new Set<number>();
  const normalized = value.toLocaleLowerCase("de-AT");
  const patterns = [
    /\b(\d{1,2})\s*\.?\s*(?:und|&|bis|-)\s*(\d{1,2})\s*\.?\s*einheit(?:en)?\b/gi,
    /\b(\d{1,2})\s*\.?\s*einheit(?:en)?\b/gi,
    /\beinheit(?:en)?\s*(\d{1,2})\b/gi,
  ];
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      for (const raw of match.slice(1)) {
        const parsed = Number(raw);
        if (Number.isInteger(parsed) && parsed > 0) output.add(parsed);
      }
    }
  }
  return output;
}

function classifyQuizCandidateKind(title: string): QuizCandidateKind {
  if (/\bselbstcheck\b/i.test(title)) return "selbstcheck";
  if (/\b(?:hausübung|hausuebung|homework)\b/i.test(title)) return "homework";
  if (/\b(?:minitest|kurztest)\b/i.test(title)) return "minitest";
  return "test";
}

function sameNumberSet(left: Set<number>, right: Set<number>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function canonicalQuizCandidateUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    if (url.pathname === "/mod/quiz/view.php" && url.searchParams.has("id")) {
      const id = url.searchParams.get("id") ?? "";
      url.search = "";
      url.searchParams.set("id", id);
    }
    return url.toString();
  } catch {
    return value;
  }
}

function isQuizActivityViewUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.pathname === "/mod/quiz/view.php" && url.searchParams.has("id");
  } catch {
    return false;
  }
}

function quizCandidateTitleQuality(title: string): number {
  const normalized = title.replace(/\s+/g, " ").trim();
  const genericPenalty = /^(?:test|quiz|moodle test)$/i.test(normalized) ? 1_000 : 0;
  const semanticBonus = extractUnitNumbers(normalized).size > 0 ? 500 : 0;
  return semanticBonus + normalized.length - genericPenalty;
}

function requestedOrdinal(prompt: string): number | null {
  if (/\b(?:erste(?:n|r|s|m)?|first)\b/i.test(prompt)) return 1;
  if (/\b(?:zweite(?:n|r|s|m)?|second)\b/i.test(prompt)) return 2;
  if (/\b(?:dritte(?:n|r|s|m)?|third)\b/i.test(prompt)) return 3;
  const numbered =
    /\b(\d{1,2})\s*\.?\s*(?:selbst[ -]?check|minitest|kurztest|quiz|test)\b/i.exec(prompt) ??
    /\b(?:selbst[ -]?check|minitest|kurztest|quiz|test)\s*(?:nummer\s*|nr\.?\s*|#\s*)?(\d{1,2})\b/i.exec(
      prompt,
    );
  const value = numbered ? Number(numbered[1]) : Number.NaN;
  return Number.isInteger(value) && value > 0 ? value : null;
}

function isRelevantCourseLink(prompt: string, label: string, url: string): boolean {
  const haystack = `${label} ${url}`.toLocaleLowerCase("de-AT");
  const lower = prompt.toLocaleLowerCase("de-AT");
  if (/dyn2|anwendungen der dynamik/.test(lower)) {
    return /dyn2|anwendungen der dynamik/.test(haystack);
  }
  if (/phdyn|grundlagen der dynamik|physikalische grundlagen/.test(lower)) {
    return /phdyn|grundlagen der dynamik|physikalische grundlagen/.test(haystack);
  }
  if (/maes2|mathe|mathematik/.test(lower)) {
    return /maes2|mathematik|engineering science/.test(haystack);
  }
  if (/et2|elektrotechnik\s*2/.test(lower)) {
    return /(^|\W)et2(\W|$)|elektrotechnik\s*2/.test(haystack);
  }
  return /course\/view\.php/.test(url);
}

export function detectQuizRisks(bodyText: string): string[] {
  const risks: string[] = [];
  if (/submit all and finish|endgültig absenden|endgueltig absenden|alle abgeben/i.test(bodyText)) {
    risks.push("final-submit-control-visible");
  }
  if (/review|überprüfung|ueberpruefung|not currently available/i.test(bodyText)) {
    risks.push("review-or-unavailable-state");
  }
  return risks;
}

export function buildQuizReviewReport(input: {
  page: QuizPageExtraction;
  target: string;
  startResult: Record<string, unknown>;
  metadata?: QuizMetadata | undefined;
  policyDecision?: QuizPolicyDecision | undefined;
  risks: string[];
  fillResults?: Array<Record<string, unknown>>;
}): string {
  const lines = [
    "= Moodle Quiz Review",
    "",
    `Target: ${input.page.url || input.target}`,
    `Title: ${input.page.title || "Untitled"}`,
    `Visible questions: ${input.page.questions.length}`,
    `Start/continue clicked: ${Boolean(input.startResult.clicked)}`,
    "Final submit clicked: false",
    "Final submission policy: blocked/manual-only",
    "",
  ];
  if (input.metadata) {
    lines.push(
      "== Quiz Metadata",
      "",
      `- configured time limit: ${input.metadata.timeLimitMinutes === null ? "unlimited" : `${input.metadata.timeLimitMinutes} minute(s)`}`,
      `- effective time available: ${input.metadata.effectiveTimeLimitMinutes === null ? "unlimited" : `${input.metadata.effectiveTimeLimitMinutes} minute(s)`}`,
      `- effective time source: ${input.metadata.effectiveTimeLimitSource}`,
      `- attempts allowed: ${input.metadata.attemptsUnlimited ? "unlimited" : (input.metadata.attemptsAllowed ?? "unknown")}`,
      `- attempts used: ${input.metadata.attemptsUsed ?? "unknown"}`,
      `- attempts left: ${input.metadata.attemptsUnlimited ? "unlimited" : (input.metadata.attemptsLeft ?? "unknown")}`,
      `- active attempt visible: ${input.metadata.hasActiveAttempt}`,
      `- can start new attempt: ${input.metadata.canStartNewAttempt}`,
      `- availability: ${input.metadata.availabilityStatus}`,
      `- opens at: ${input.metadata.opensAt ?? "unknown"}`,
      `- closes at: ${input.metadata.closesAt ?? "unknown"}`,
      `- availability evidence: ${input.metadata.availabilityEvidence.join(", ") || "none"}`,
      `- appears timed: ${input.metadata.appearsTimed}`,
      `- appears limited-attempt: ${input.metadata.appearsLimitedAttempt}`,
      "",
    );
  }
  if (input.policyDecision && input.policyDecision.status !== "allowed") {
    lines.push(
      "== Quiz Safety Stop",
      "",
      `- status: ${input.policyDecision.status}`,
      `- action: ${input.policyDecision.action}`,
      `- reason: ${input.policyDecision.reason}`,
      `- needed permission: ${input.policyDecision.neededPermission}`,
      "",
    );
  }
  if (input.risks.length) {
    lines.push("== Risk Flags", "", ...input.risks.map((risk) => `- ${risk}`), "");
  }
  if (input.fillResults?.length) {
    lines.push("== Fill Results", "");
    for (const result of input.fillResults) {
      if (result.action === "navigation") {
        lines.push(
          `- navigation page ${result.page_number}: clicked=${result.clicked} kind=${result.kind ?? ""} reason=${result.reason ?? ""}`,
        );
      } else if (result.action === "policy") {
        lines.push(
          `- policy ${result.policy_action}: status=${result.status} reason=${result.reason} needed_permission=${result.needed_permission}`,
        );
      } else {
        lines.push(
          `- question ${result.question_index}: filled=${Boolean(result.filled)} persisted=${String(result.persisted ?? "unknown")} reason=${String(result.reason ?? "")}`,
        );
      }
    }
    lines.push("");
  }
  lines.push("== Questions", "");
  if (!input.page.questions.length) {
    lines.push("No visible questions were extracted.");
  }
  for (const question of input.page.questions) {
    lines.push(
      `=== Frage ${question.question_index}`,
      "",
      question.prompt || "No prompt extracted.",
      "",
    );
    for (const option of question.options) {
      lines.push(`- ${option}`);
    }
    lines.push("");
  }
  return appendQuizLinkToReport(`${lines.join("\n")}\n`, input.target);
}

export function appendQuizLinkToReport(report: string, quizUrl: string): string {
  const body = report.replace(
    /\n== Quiz öffnen\n\n#link\([^\n]*\)\[Quiz in Moodle öffnen\]\n?/g,
    "",
  );
  return [
    body.trimEnd(),
    "",
    "== Quiz öffnen",
    "",
    `#link(${JSON.stringify(quizUrl)})[Quiz in Moodle öffnen]`,
    "",
  ].join("\n");
}

function buildNoQuizReport(prompt: string): string {
  return [
    "= Moodle Quiz Review",
    "",
    `Prompt: ${prompt}`,
    "",
    "No matching Moodle quiz target was found in the inspected 2.0 crawl.",
    "",
    "Final submit clicked: false",
    "",
  ].join("\n");
}

export async function persistQuizArtifacts(
  config: MoodleRuntimeConfig,
  payload: {
    report: string;
    questions: QuizQuestion[];
    candidates: QuizCandidate[];
    targetUrl: string | null;
    finalSubmitClicked: boolean;
    startResult?: Record<string, unknown>;
    metadata?: QuizMetadata | undefined;
    policyDecision?: QuizPolicyDecision | undefined;
    risks?: string[];
    fillResults?: Array<Record<string, unknown>>;
  },
): Promise<void> {
  await mkdir(config.runDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(config.runDir, "quiz-review.typ"), payload.report, "utf8"),
    writeFile(
      path.join(config.runDir, "quiz-review.json"),
      `${JSON.stringify(
        {
          captured_at: new Date().toISOString(),
          prompt: config.prompt,
          original_user_prompt: config.originalUserPrompt,
          output_language: config.outputLanguage,
          target_url: payload.targetUrl,
          questions: payload.questions,
          candidates: payload.candidates,
          start_result: payload.startResult ?? {},
          quiz_metadata: payload.metadata ?? null,
          policy_decision: payload.policyDecision ?? null,
          risks: payload.risks ?? [],
          fill_results: payload.fillResults ?? [],
          final_submit_clicked: payload.finalSubmitClicked,
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
  ]);
}

async function stopForQuizPolicy(
  config: MoodleRuntimeConfig,
  state: LangGraphAgentState,
  target: string,
  decision: QuizPolicyDecision,
  metadata?: QuizMetadata,
): Promise<Partial<LangGraphAgentState>> {
  const page: QuizPageExtraction = {
    title: "Quiz Safety Stop",
    url: target,
    body_text: "",
    questions: [],
  };
  const fillResults = [policyDecisionResult(decision)];
  const permissionRequest =
    decision.status === "permission_required"
      ? buildPendingQuizPermissionRequest({
          targetUrl: target,
          quizTitle: page.title,
          decision,
          metadata,
        })
      : null;
  const permissionRequestPath = permissionRequest
    ? await persistPendingQuizPermission(config, permissionRequest)
    : null;
  const report = buildQuizReviewReport({
    page,
    target,
    startResult: { clicked: false, reason: decision.reason },
    metadata,
    policyDecision: decision,
    risks: [],
    fillResults,
  });
  const finalReport = permissionRequestPath
    ? appendQuizLinkToReport(
        `${report}\n\n== Native approval required\n\nPermission request: ${permissionRequestPath}\n`,
        target,
      )
    : report;
  await persistQuizArtifacts(config, {
    report: finalReport,
    questions: [],
    candidates: [],
    targetUrl: target,
    finalSubmitClicked: false,
    startResult: { clicked: false, reason: decision.reason },
    metadata,
    policyDecision: decision,
    risks: [],
    fillResults,
  });
  return {
    final_document: finalReport,
    extracted_data: toJsonObject({
      kind: "quiz_review",
      status: decision.status,
      target_url: target,
      questions: [],
      quiz_metadata: metadata ?? null,
      policy_decision: decision,
      pending_permission: permissionRequest,
      final_submit_clicked: false,
    }),
    source_coverage: {
      ...state.source_coverage,
      moodle: {
        status: "empty",
        detail: `Quiz safety stopped ${decision.action}: ${decision.reason}.`,
        urls: [target],
        pages: 1,
      },
    },
    error_log: null,
  };
}

export function policyDecisionResult(
  decision: QuizPolicyDecision,
  pageNumber?: number,
): Record<string, unknown> {
  return {
    ...(pageNumber === undefined ? {} : { page_number: pageNumber }),
    action: "policy",
    policy_action: decision.action,
    status: decision.status,
    filled: false,
    clicked: false,
    reason: decision.reason,
    needed_permission: decision.neededPermission,
  };
}

export function formatQuizRawText(page: QuizPageExtraction): string {
  return [
    "[Moodle quiz]",
    `Title: ${page.title}`,
    `URL: ${page.url}`,
    "",
    ...page.questions.map((question) =>
      [
        `Question ${question.question_index}: ${question.prompt}`,
        ...question.options.map((option) => `- ${option}`),
      ].join("\n"),
    ),
  ].join("\n");
}
