import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentBrowserClient } from "./agentBrowserClient.js";
import type { CodexClient } from "./codexClient.js";
import { extractQuizUrls, normalizeQuizUrl } from "./quizIntent.js";
import { quizDateMatches, quizRequestTime } from "./quizTargetDate.js";
import { extractQuizMetadata, type QuizMetadata } from "./quizSafetyPolicy.js";
import { discoverQuizTarget, selectQuizCandidate, type QuizCandidate } from "./nodes/quizReviewNode.js";
import type { MoodleRuntimeConfig } from "./types.js";

/** null means every matching quiz in the resolved course, not every enrolled course. */
export function requestedQuizCount(prompt: string): number | null {
  const plural = "(?:quiz(?:zes)?|mini[ -]?tests?|kurz[ -]?tests?|tests?|self[ -]?checks?|selbstchecks?)";
  const modifiers = "(?:(?!(?:fragen|questions|antworten|answers|seiten|pages|in|im|aus|from)\\b)[\\p{L}-]+\\s+){0,4}";
  if (new RegExp(`\\b(?:alle|sämtliche|saemtliche|all|every)\\s+${modifiers}${plural}\\b`, "iu").test(prompt)) return null;
  if (/\b(?:beide|both)\b(?!\s+(?:fragen|questions|antworten|answers|seiten|pages)\b)/i.test(prompt)) return 2;
  const count = new RegExp(`\\b(\\d+|zwei|drei|vier|fünf|fuenf|two|three|four|five)\\s+${modifiers}${plural}\\b`, "iu").exec(prompt)?.[1]?.toLowerCase();
  if (!count) return 1;
  const words: Record<string, number> = { zwei: 2, drei: 3, vier: 4, fünf: 5, fuenf: 5, two: 2, three: 3, four: 4, five: 5 };
  const value = words[count] ?? Number(count);
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

interface TargetEvidence {
  url: string;
  availability?: QuizMetadata["availabilityStatus"];
  activeAttempt?: boolean;
  accepted: boolean;
  reason: string;
}

/** Resolve once, then give each URL its own browser/run. Never starts an attempt. */
export async function resolveQuizTargets(
  config: MoodleRuntimeConfig,
  client: AgentBrowserClient,
  codex?: CodexClient,
): Promise<string[]> {
  const explicit = extractQuizUrls(config.prompt);
  const configuredTarget = normalizeQuizUrl(config.moodleUrl);
  if (!explicit.length && configuredTarget) explicit.push(configuredTarget);
  const requested = explicit.length || requestedQuizCount(config.prompt);
  const evidence: TargetEvidence[] = [];
  const persist = async (urls: string[], reason: string): Promise<string[]> => {
    await mkdir(config.runDir, { recursive: true });
    await writeFile(path.join(config.runDir, "quiz-targets.json"), JSON.stringify({
      requestedCount: requested, selectedUrls: urls,
      missingCount: requested === null ? null : Math.max(0, requested - urls.length),
      status: urls.length === 0 ? "blocked" : requested !== null && urls.length < requested ? "partial" : "resolved",
      reason, evidence,
    }, null, 2) + "\n");
    return urls;
  };
  if (explicit.length) return persist(explicit, "explicit-quiz-urls");
  if (config.quizSafetyPolicy?.allowOpeningQuizPages === false) return persist([], "quiz-page-opening-disabled");

  const selected = await discoverQuizTarget(config, client, codex);
  let candidates: QuizCandidate[];
  try {
    candidates = JSON.parse(await readFile(path.join(config.runDir, "quiz-candidates.json"), "utf8")) as QuizCandidate[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return persist([], "course-or-target-unresolved");
  }
  // The discovery pass owns course scope. Only consider its recorded candidates,
  // and retain its ordinal/unit selection rules after availability inspection.
  const time = quizRequestTime(config);
  const eligible: QuizCandidate[] = [];
  for (const candidate of candidates) {
    const url = normalizeQuizUrl(candidate.url);
    if (!url || new URL(url).origin !== new URL(config.baseUrl).origin) continue;
    try {
      await client.open(url);
      const metadata = await extractQuizMetadata(client);
      const available = metadata.hasActiveAttempt ||
        (metadata.availabilityStatus === "open" && metadata.canStartNewAttempt && metadata.attemptsLeft !== 0);
      const dateMatches = time.status === "none" || quizDateMatches(metadata, time);
      const accepted = available && dateMatches;
      evidence.push({ url, availability: metadata.availabilityStatus, activeAttempt: metadata.hasActiveAttempt, accepted,
        reason: !available ? "not-attemptable" : !dateMatches ? "requested-date-unconfirmed" : "attemptable" });
      if (accepted) eligible.push({ ...candidate, url, score: candidate.score + (metadata.hasActiveAttempt ? 10_000 : 0) });
    } catch {
      evidence.push({ url, accepted: false, reason: "availability-inspection-failed" });
    }
  }
  // A temporal single-target request still needs a unique date-confirmed match.
  if (requested === 1 && time.status !== "none" && !selected && eligible.length !== 1) {
    return persist([], "no-unique-date-confirmed-target");
  }
  const targets: string[] = [];
  const remaining = [...eligible];
  while (remaining.length && (requested === null || targets.length < requested)) {
    const target = selectQuizCandidate(config.prompt, remaining);
    if (!target) break;
    targets.push(target.url);
    remaining.splice(remaining.findIndex(candidate => candidate.url === target.url), 1);
  }
  return persist(targets, targets.length ? "attemptable-targets-selected" : "no-matching-attemptable-target");
}
