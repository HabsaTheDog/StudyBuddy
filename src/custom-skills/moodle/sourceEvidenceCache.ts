import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MoodleRuntimeConfig } from "./types.js";
import type { EvidenceCard, ObligationFact } from "./obligationInventory.js";
import { resolveTemporalRequest } from "./temporalRequest.js";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** A desktop account may reuse proofs across quick chats; anonymous/browser-only
 * sessions retain the existing workspace isolation. No credentials are stored. */
export function sourceCacheRoot(config: Pick<MoodleRuntimeConfig, "runtimeCacheDir" | "baseUrl" | "username">, environment = process.env): string {
  const root = environment.STUDY_BUDDY_SOURCE_CACHE_ROOT || (environment.STUDY_BUDDY_CONFIG_ROOT
    ? path.join(environment.STUDY_BUDDY_CONFIG_ROOT, "study-buddy-data", "cache", "sources") : undefined);
  if (root && path.isAbsolute(root) && config.username?.trim()) {
    return path.join(root, digest([config.baseUrl, config.username]));
  }
  return path.join(config.runtimeCacheDir, "sources", digest([config.baseUrl, config.username ?? "workspace-session"]));
}

export function evidenceSourceText(card: EvidenceCard): string {
  return [`Course: ${card.course}`, card.label, card.accessible === undefined ? "" : `Moodle user access: ${card.accessible}`, card.availabilityText, card.text, card.context, card.index, card.landing].filter(Boolean).join("\n");
}

export function isGradeOnlyEvidence(quote: string): boolean {
  return /^(?:grade|bewertung|note|points|punkte)\s*:\s*[-\d.,%/\s]+$/i.test(quote.trim());
}

const INTERACTIVE_TASK_METADATA = /neue aufgabe|ergebnisse einloggen|(?:abzug|abzüge|abzuege) vom gesamtergebnis|record results|submit (?:answer|results)|check (?:your )?answer|new (?:exercise|problem)|enter (?:your )?answer/i;

/** The native launch label cannot prove that a general external home contains
 * the requested numbered task. An identifier buried in a chapter's link list
 * is not task evidence. A launch heading is also insufficient while an embedded
 * task loads: require the identity and actual task/deadline metadata together. */
export function missingExternalTaskEvidence(card: EvidenceCard): boolean {
  if (card.kind !== "lti" || !card.read) return false;
  const identifier = card.label.match(/^\s*(\d+(?:[.:-]\d+)+)\b/)?.[1];
  if (!identifier) return false;
  const external = card.landing.split(/^(?:External source:[^\n]*|Embedded content from the activity page)\n/m).slice(1);
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Chapter/section numbers inside a different task are not its identity.
  const identity = new RegExp(`(?:^\\s*|\\b(?:example|exercise|task|beispiel|aufgabe)\\s*:?\\s+)${escaped}(?![\\d.])`, "i");
  const deadlineMetadata = /(?:due date|deadline|abgabefrist|fälligkeitsdatum|submission status|abgabestatus)\s*:/i;
  return !external.some(content => identity.test(content) && (INTERACTIVE_TASK_METADATA.test(content) || deadlineMetadata.test(content)));
}

/** A blank index date is not evidence against dates in the actual activity.
 * Reconcile those dates semantically; they may be openings or closing instructions. */
export function missingDeadlineFieldNeedsReconciliation(card: EvidenceCard, quote: string, reference = new Date(), timeZone?: string): boolean {
  if (!/^(?:deadline|due date|abgabefrist|fälligkeitsdatum)\s*:\s*(?:[-–—]|no deadline|not set|keine frist|keine abgabefrist|nicht festgelegt)?\.?\s*$/i.test(quote.trim())) return false;
  const source = [card.text, card.landing].filter(Boolean).join("\n");
  // Native Moodle metadata includes opening, grading and modification dates.
  // Remove only an independently parsed absolute date immediately following
  // one of those labels. Keep every other date, especially closing instructions.
  const metadataDate = /\b(?:geöffnet|opened|opens|available from|bewertet am|graded on|zuletzt geändert|last modified)\s*:?\s*(?:(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s*)?(?:\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{4}|\d{1,2}\.?\s*[\p{L}]+\.?\s+\d{4}|[\p{L}]+\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})(?:,?\s+\d{1,2}:\d{2})?/giu;
  const remaining = source.replace(metadataDate, value => resolveTemporalRequest(value, reference, timeZone).status === "resolved" ? "" : value);
  return resolveTemporalRequest(remaining, reference, timeZone).status !== "none";
}

export function externalExclusionAllowed(card: EvidenceCard, evidence: string): boolean {
  if (card.kind !== "lti") return true;
  if (!card.read && !card.failed) return false;
  // A failed read does not erase independently verified course-context evidence
  // of a demonstration or administrative resource. It never proves a deadline,
  // completion, or non-assessment by itself; failed sources are never cached.
  if (card.failed) return true;
  const interactive = INTERACTIVE_TASK_METADATA.test(card.landing);
  return !interactive || /\bungraded\b|\bunbenotet\w*|\bunbewertet\w*|not graded|not assessed|ohne bewertung|nicht (?:benotet|bewertet)/i.test(evidence);
}

export function sourceBackedStatus(card: EvidenceCard, fact: ObligationFact, language: string): string {
  if (["not_obligation", "completed", "needs_read"].includes(fact.disposition)) return fact.status;
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
  const status = normalize(fact.status);
  // A visible exercise or score input alone does not establish personal progress.
  return status && card.read && normalize(card.landing).includes(status) ? fact.status : language === "en" ? "unknown" : "unbekannt";
}

export class SourceEvidenceCache {
  hits = 0;
  writes = 0;
  constructor(private config: MoodleRuntimeConfig, private root = path.join(sourceCacheRoot(config), "obligations"), private now = Date.now) {}

  private fingerprint(card: EvidenceCard): string {
    return digest(["obligation-proof-v1", this.config.baseUrl, this.config.username, this.config.originalUserPrompt, this.config.outputLanguage,
      card.id, card.url, card.courseId, card.course, card.courseEnd, card.kind, card.read, card.accessRequirements, evidenceSourceText(card)]);
  }

  async read(card: EvidenceCard): Promise<ObligationFact | null> {
    if (card.failed) return null;
    try {
      const key = this.fingerprint(card);
      const cached = JSON.parse(await readFile(path.join(this.root, `${key}.json`), "utf8"));
      if (cached.version !== 1 || cached.key !== key || !Number.isFinite(cached.createdAt) || this.now() - cached.createdAt < 0 || this.now() - cached.createdAt >= 24 * 60 * 60_000) return null;
      const fact = cached.fact as ObligationFact;
      if (!this.valid(card, fact)) return null;
      const result = { ...fact, label: card.label, course: card.course, courseId: card.courseId };
      result.status = sourceBackedStatus(card, result, this.config.outputLanguage);
      if (result.disposition === "due" || result.disposition === "outside_range") {
        const time = this.config.temporalRequest;
        if (time?.status !== "resolved" || !time.start || !time.end || !evidenceSourceText(card).includes(result.dateQuote)) return null;
        const date = resolveTemporalRequest(result.dateQuote, new Date(time.resolvedAt), time.timeZone);
        if (date.status !== "resolved" || !date.start || !date.end || new Date(date.end).toLocaleDateString("en-CA", { timeZone: time.timeZone }) !== result.dueDate) return null;
        result.disposition = date.start <= time.end && date.end >= time.start ? "due" : "outside_range";
      }
      this.hits++;
      return result;
    } catch { return null; }
  }

  async write(card: EvidenceCard, fact: ObligationFact): Promise<void> {
    if (!this.valid(card, fact)) return;
    const key = this.fingerprint(card);
    try {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      const target = path.join(this.root, `${key}.json`);
      const temporary = `${target}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify({ version: 1, key, createdAt: this.now(), fact }), { mode: 0o600 });
      await rename(temporary, target);
      this.writes++;
    } catch { /* A cache failure never changes the source result. */ }
  }

  private valid(card: EvidenceCard, fact: ObligationFact): boolean {
    return !card.failed && !!fact && fact.id === card.id && fact.url === card.url && fact.courseId === card.courseId &&
      ["not_obligation", "no_deadline", "completed", "due", "outside_range"].includes(fact.disposition) &&
      typeof fact.status === "string" && typeof fact.reason === "string" && typeof fact.dateQuote === "string" &&
      (!fact.dateQuote || evidenceSourceText(card).includes(fact.dateQuote)) &&
      (fact.dueDate === null || (typeof fact.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fact.dueDate))) &&
      (fact.dateUncertain === undefined || typeof fact.dateUncertain === "boolean") &&
      typeof fact.evidence === "string" && fact.evidence.length >= 4 && evidenceSourceText(card).includes(fact.evidence) &&
      (fact.disposition !== "not_obligation" || !isGradeOnlyEvidence(fact.evidence)) &&
      (fact.disposition !== "not_obligation" || externalExclusionAllowed(card, fact.evidence)) &&
      (fact.disposition !== "no_deadline" || !missingDeadlineFieldNeedsReconciliation(card, fact.evidence, new Date(this.config.temporalRequest?.resolvedAt ?? this.now()), this.config.temporalRequest?.timeZone)) &&
      (fact.disposition !== "no_deadline" || !missingExternalTaskEvidence(card)) &&
      (!["no_deadline", "completed"].includes(fact.disposition) || card.read);
  }
}
