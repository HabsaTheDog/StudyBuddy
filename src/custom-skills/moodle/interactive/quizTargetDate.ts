import { requestTimeBoundary, timestampMatchesRequest, type TemporalRequest } from "../temporalRequest.js";
import type { QuizMetadata, QuizPolicyDecision } from "./quizSafetyPolicy.js";
import type { MoodleRuntimeConfig } from "./types.js";

export function quizRequestTime(config: MoodleRuntimeConfig): TemporalRequest {
  return config.temporalRequest ?? requestTimeBoundary(config.originalUserPrompt ?? config.prompt, config.prompt);
}

export function quizDateMatches(metadata: QuizMetadata, request: TemporalRequest): boolean {
  // A close time proves a due date; an opening time alone never proves a deadline.
  return timestampMatchesRequest(metadata.closesAt, request) ||
    (request.relation !== "until" && timestampMatchesRequest(metadata.opensAt, request));
}

export function quizDateGate(config: MoodleRuntimeConfig, metadata: QuizMetadata): QuizPolicyDecision | null {
  const request = quizRequestTime(config);
  if (request.status === "none" || quizDateMatches(metadata, request)) return null;
  return {
    status: "blocked", action: "start_or_continue_attempt",
    reason: request.status === "unresolved" ? "quiz-request-date-unresolved" : "quiz-target-date-unconfirmed",
    neededPermission: "resolve_matching_quiz_target",
  };
}
