import type { AgentState, SourceCoverage } from "./state.js";

export type StudyBuddyReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

export interface QuizSolverModelPolicy {
  model: string;
  reasoningEffort: StudyBuddyReasoningEffort;
  retryModel: string;
  retryReasoningEffort: StudyBuddyReasoningEffort;
}

export interface MoodleGraphInput {
  prompt: string;
  moodleUrl: string;
  outputPath?: string | undefined;
  runDir?: string | undefined;
  maxDepth?: number | undefined;
  maxPages?: number | undefined;
  allowFileDownloads?: boolean | undefined;
  cisUrls?: string[] | undefined;
  calendarUrl?: string | undefined;
  maxCisPages?: number | undefined;
  browserBackend?: BrowserBackend | undefined;
  cisBrowserBackend?: BrowserBackend | undefined;
  browserHeaded?: boolean | undefined;
  keepBrowserOpen?: boolean | undefined;
  browserMaxOutput?: number | undefined;
  autoAnswer?: boolean | undefined;
  quizSafetyPolicy?: Partial<QuizSafetyPolicy> | undefined;
  approvedQuizPermission?: ApprovedQuizPermission | undefined;
  assignmentFiles?: string[] | undefined;
  approvedAssignmentPermission?: ApprovedAssignmentPermission | undefined;
  codexModel?: string | undefined;
  executionProfile?: string | undefined;
  codexReasoningEffort?: string | undefined;
  quizSolverModel?: string | undefined;
  quizSolverReasoningEffort?: StudyBuddyReasoningEffort | undefined;
  quizSolverRetryModel?: string | undefined;
  quizSolverRetryReasoningEffort?: StudyBuddyReasoningEffort | undefined;
}

export interface MoodleGraphResult {
  ok: boolean;
  workflowStatus: MoodleWorkflowStatus;
  coverageComplete: boolean;
  runDir: string;
  outputPath?: string;
  pdfPath?: string;
  answerPath?: string;
  answerJsonPath?: string;
  state: AgentState;
  sourceCoverage: SourceCoverage;
  permissionRequestPath?: string;
  error?: string;
}

export type MoodleWorkflowStatus =
  | "completed"
  | "permission_required"
  | "target_not_found"
  | "blocked"
  | "manual_action_required"
  | "failed";

export interface MoodleRuntimeConfig {
  prompt: string;
  moodleUrl: string;
  outputPath: string;
  runDir: string;
  maxDepth: number;
  maxPages: number;
  maxCisPages: number;
  allowFileDownloads: boolean;
  baseUrl: string;
  dashboardUrl: string;
  username?: string | undefined;
  password?: string | undefined;
  storageState?: string | undefined;
  cisUrls: string[];
  calendarUrl?: string | undefined;
  cisBaseUrl: string;
  cisDashboardUrl: string;
  cisUsername?: string | undefined;
  cisPassword?: string | undefined;
  cisStorageState?: string | undefined;
  headless: boolean;
  browserBackend?: BrowserBackend | undefined;
  cisBrowserBackend?: BrowserBackend | undefined;
  agentBrowserBin?: string | undefined;
  browserSession?: string | undefined;
  browserSessionName?: string | undefined;
  browserAllowedDomains?: string[] | undefined;
  moodleLoginAllowedOrigins?: string[] | undefined;
  cisLoginAllowedOrigins?: string[] | undefined;
  browserActionPolicyPath?: string | undefined;
  browserMaxOutput?: number | undefined;
  keepBrowserOpen?: boolean | undefined;
  autoAnswer?: boolean | undefined;
  quizSafetyPolicy?: QuizSafetyPolicy | undefined;
  approvedQuizPermission?: ApprovedQuizPermission | undefined;
  assignmentFiles?: string[] | undefined;
  approvedAssignmentPermission?: ApprovedAssignmentPermission | undefined;
  codexModel?: string | undefined;
  quizSolverModelPolicy?: QuizSolverModelPolicy | undefined;
}

export type BrowserBackend = "agent-browser" | "playwright";

export type QuizAccessMode =
  | "review-only"
  | "ask-before-attempt"
  | "quiz-assist"
  | "full-study-assist";

export interface ApprovedQuizPermission {
  requestId: string;
  requestPath: string;
  targetUrl: string;
  action: "execute_quiz_attempt";
  scope: "exact_quiz_attempt";
  approvedAt: string;
  expiresAt: string;
}

export interface ApprovedAssignmentPermission {
  requestId: string;
  targetUrl: string;
  action: "submit_assignment";
  scope: "exact_assignment_submission";
  approvedAt: string;
  expiresAt: string;
  files: AssignmentFileGrant[];
}

export interface AssignmentFileGrant {
  path: string;
  size: number;
  sha256: string;
}

export interface QuizSafetyPolicy {
  accessMode: QuizAccessMode;
  allowOpeningQuizPages: boolean;
  allowStartingOrContinuingAttempts: boolean;
  minimumTimeLimitMinutes: number;
  minimumAttemptsLeft: number;
  allowReadingQuestions: boolean;
  allowSuggestingAnswers: boolean;
  allowFillingAnswers: boolean;
  allowChangingExistingAnswers: boolean;
  allowSavingMovingNext: boolean;
  askBeforeStartingOrContinuingAttempts: boolean;
  askBeforeTimedQuizzes: boolean;
  askBeforeLimitedAttemptQuizzes: boolean;
  askBeforeFillingAnswers: boolean;
  askBeforeChangingExistingAnswers: boolean;
  fillConfidenceThreshold: number;
  finalSubmissionBlocked: true;
}
