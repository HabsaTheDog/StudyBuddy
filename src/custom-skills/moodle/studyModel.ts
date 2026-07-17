import { createHash } from "node:crypto";
import type { ExtractedData } from "./schemas.js";
import {
  StudyModelSchema,
  type CourseChapter,
  type CoverageAssessment,
  type ResourceManifest,
  type StudyModel,
} from "./examNavigatorContracts.js";
import { isResourceFailureStatus } from "./resourceAcquisition.js";
import {
  isGenericLearningGoal,
  isOrganizationalPracticeQuestion,
} from "./studentFirstPolicy.js";
import type { MoodleRuntimeConfig } from "./types.js";

export function buildStudyModel(
  config: MoodleRuntimeConfig,
  extracted: ExtractedData,
  manifest: ResourceManifest,
  coverage: CoverageAssessment,
): StudyModel {
  const profile = config.artifactIntent.profile;
  const sources = sourceEntries(extracted, manifest);
  const sourceIds = new Set(sources.map((source) => source.id));
  const chapterDrafts = buildCourseChapters(manifest);
  const topics = extracted.sections
    .filter((section) => !isOrganizationalSection(section.heading))
    .filter((section) => section.source_ids.some((sourceId) => sourceIds.has(sourceId)))
    .map((section, index) => {
      const learningGoals = section.key_concepts
        .map((concept) => concept.trim())
        .filter((concept) => !isGenericLearningGoal(concept))
        .filter((concept) => !isOrganizationalConcept(concept))
        .slice(0, 6);
      if (learningGoals.length === 0) {
        learningGoals.push(firstSentence(section.summary));
      }
      return {
        id: stableId(`${section.heading}:${section.source_ids.join(",")}`, "topic"),
        chapterId: selectChapterId(
          section.heading,
          section.source_ids,
          extracted,
          manifest,
          chapterDrafts,
        ),
        title: section.heading,
        summary: section.summary,
        priority: index < 3 ? "essential" as const : "important" as const,
        scopeStatus: "inferred" as const,
        learningGoals,
        sourceIds: section.source_ids.filter((sourceId) => sourceIds.has(sourceId)),
      };
    })
    .sort((left, right) =>
      chapterOrder(left.chapterId, chapterDrafts) - chapterOrder(right.chapterId, chapterDrafts)
    );

  const courseChapters = chapterDrafts.map((chapter) => {
    const topicIds = topics
      .filter((topic) => topic.chapterId === chapter.id)
      .map((topic) => topic.id);
    const resourceIds = chapter.resourceIds.filter((resourceId) => sourceIds.has(resourceId));
    const chapterResources = manifest.resources.filter((resource) =>
      resourceIds.includes(resource.id)
    );
    return {
      ...chapter,
      resourceIds,
      topicIds,
      status: topicIds.length === 0
        ? "missing" as const
        : hasExplicitChapterGap(chapter.subject, extracted.warnings)
          ? "partial" as const
        : chapterResources.some((resource) => isResourceFailureStatus(resource.status))
          ? "partial" as const
          : "covered" as const,
    };
  });

  const formulas = extracted.formulas
    .filter(
      (formula) =>
        formula.source_ids.some((sourceId) => sourceIds.has(sourceId)) &&
        formula.variables.length > 0 &&
        formula.units.length > 0 &&
        formula.context.trim().length > 0,
    )
    .map((formula) => ({
      id: stableId(`${formula.name}:${formula.typst}`, "formula"),
      chapterId: selectChapterId(
        formula.name,
        formula.source_ids,
        extracted,
        manifest,
        courseChapters,
      ),
      name: formula.name,
      expression: formula.typst,
      variables: formula.variables,
      units: formula.units,
      assumptions: formula.context,
      sourceIds: formula.source_ids.filter((sourceId) => sourceIds.has(sourceId)),
    }));

  const workedExamples = extracted.worked_examples
    .filter(
      (example) =>
        example.source_ids.some((sourceId) => sourceIds.has(sourceId)) &&
        example.steps.length > 0 &&
        example.result.trim().length > 0,
    )
    .map((example) => ({
      id: stableId(`${example.prompt}:${example.result}`, "example"),
      chapterId: selectChapterId(
        example.prompt,
        example.source_ids,
        extracted,
        manifest,
        courseChapters,
      ),
      origin: example.origin,
      learningGoal: example.learning_goal || inferExampleLearningGoal(example.prompt),
      prompt: example.prompt,
      steps: example.steps,
      result: example.result,
      sourceIds: example.source_ids.filter((sourceId) => sourceIds.has(sourceId)),
    }));

  const assetsById = new Map(extracted.visual_assets.map((asset) => [asset.id, asset]));
  const figures = extracted.figures.flatMap((figure) => {
    const asset = assetsById.get(figure.asset_id);
    if (!asset) return [];
    const figureSourceIds = unique([
      ...figure.source_ids,
      ...(asset.source_id ? [asset.source_id] : []),
    ]).filter((sourceId) => sourceIds.has(sourceId));
    return [{
      id: stableId(`${figure.asset_id}:${figure.caption}`, "figure"),
      chapterId: selectChapterId(
        `${figure.caption} ${figure.placement_hint}`,
        figureSourceIds,
        extracted,
        manifest,
        courseChapters,
      ),
      kind: asset.kind,
      title: asset.title,
      caption: figure.caption,
      relativePath: asset.relative_path,
      sourcePage: asset.source_page,
      widthPx: asset.width_px,
      heightPx: asset.height_px,
      sourceIds: figureSourceIds,
      generationPrompt: asset.generation_prompt,
    }];
  });

  const practiceItems =
    profile === "interactive_learning" || profile === "practice_pack"
      ? extracted.quiz_style_questions
          .filter((question) => !isOrganizationalPracticeQuestion(question.question))
          .filter((question) => question.source_ids.some((sourceId) => sourceIds.has(sourceId)))
          .map((question) => ({
            id: stableId(question.question, "practice"),
            kind: "question" as const,
            prompt: question.question,
            answer: question.answer,
            learningGoal: inferPracticeLearningGoal(question.question),
            sourceIds: question.source_ids.filter((sourceId) => sourceIds.has(sourceId)),
          }))
      : [];

  const checklist = unique(
    topics.map((topic) => checklistItem(
      extracted.language,
      topic.learningGoals[0],
      topic.title,
    )),
  );

  const english = extracted.language === "en";
  const publicationStatus = coverage.status === "complete" &&
      courseChapters.some((chapter) => chapter.status !== "covered")
    ? "partial" as const
    : coverage.status;

  return StudyModelSchema.parse({
    schemaVersion: "1.0",
    profile,
    language: extracted.language,
    title: profile === "study_guide" && courseChapters.length > 1
      ? `${extracted.course.title || "Kurs"} – Study Guide`
      : extracted.document_title,
    courseTitle: extracted.course.title || "Unbekannter Kurs",
    courseUrl: extracted.course.url || manifest.courseUrl,
    publicationStatus,
    scopeNote:
      publicationStatus === "complete"
        ? english
          ? "The presented content is supported by the evaluated sources."
          : "Die dargestellten Inhalte sind durch die ausgewerteten Quellen belegt."
        : extracted.warnings.find((warning) => /\b(?:fehlt|keine|nicht|missing|unavailable|no usable)\b/i.test(warning)) ?? coverage.detail,
    courseChapters,
    topics,
    formulas,
    workedExamples,
    figures,
    checklist,
    practiceItems,
    sources,
    warnings: unique([...extracted.warnings, ...coverage.criticalMissing]),
  });
}

function hasExplicitChapterGap(subject: string, warnings: string[]): boolean {
  const terms = normalizeSubject(subject)
    .split(" ")
    .map(stemSubjectToken)
    .filter((term) => term.length >= 5);
  return warnings.some((warning) => {
    const normalized = normalizeSubject(warning);
    const describesGap = /\b(?:fehlt|fehlend|keine|nicht|missing|unavailable|no usable)\b/i.test(warning);
    return describesGap && terms.some((term) => normalized.includes(term));
  });
}

function sourceEntries(extracted: ExtractedData, manifest: ResourceManifest): StudyModel["sources"] {
  const manifestByUrl = new Map(manifest.resources.map((resource) => [resource.originUrl, resource]));
  const sources: StudyModel["sources"] = extracted.sources.map((source) => {
    const normalizedUrl = normalizeUrl(source.url);
    const resource = normalizedUrl ? manifestByUrl.get(normalizedUrl) : undefined;
    return {
      id: source.id,
      title: source.title,
      originUrl: source.url,
      localPath: source.path ?? resource?.localPath ?? null,
      previewPath: resource?.previewPath ?? source.path ?? null,
      kind: source.kind,
    };
  });
  for (const resource of manifest.resources) {
    if (!isStudentFacingResource(resource)) continue;
    if (sources.some((source) => normalizeUrl(source.originUrl) === resource.originUrl)) continue;
    sources.push({
      id: resource.id,
      title: resource.title,
      originUrl: resource.originUrl,
      localPath: resource.localPath,
      previewPath: resource.previewPath,
      kind: resource.activityType,
    });
  }
  return sources;
}

function buildCourseChapters(manifest: ResourceManifest): CourseChapter[] {
  const chapters: CourseChapter[] = [];
  for (const resource of manifest.resources) {
    for (const sectionTitle of resource.sectionPath) {
      const parsed = parseLearningSection(sectionTitle);
      if (!parsed) continue;
      let chapter = chapters.find((candidate) =>
        subjectSimilarity(candidate.subject, parsed.subject) >= 0.68
      );
      if (!chapter) {
        chapter = {
          id: stableId(normalizeSubject(parsed.subject), "chapter"),
          title: sectionTitle,
          subject: parsed.subject,
          order: parsed.order,
          status: "missing",
          topicIds: [],
          resourceIds: [],
        };
        chapters.push(chapter);
      }
      if (
        parsed.kind === "eigenstudium" &&
        !/\beigenstudium\b/i.test(chapter.title)
      ) {
        chapter.title = sectionTitle;
      }
      chapter.order = Math.min(chapter.order, parsed.order);
      if (!chapter.resourceIds.includes(resource.id)) {
        chapter.resourceIds.push(resource.id);
      }
    }
  }
  return chapters.sort((left, right) =>
    left.order - right.order || left.title.localeCompare(right.title, "de")
  );
}

function selectChapterId(
  label: string,
  sourceIds: string[],
  extracted: ExtractedData,
  manifest: ResourceManifest,
  chapters: CourseChapter[],
): string | null {
  if (chapters.length === 0) return null;
  const extractedSources = new Map(extracted.sources.map((source) => [source.id, source]));
  const resourcesByUrl = new Map(
    manifest.resources.map((resource) => [normalizeUrl(resource.originUrl), resource]),
  );
  const votes = new Map<string, number>();
  const sourceContext: string[] = [label];
  for (const sourceId of sourceIds) {
    const source = extractedSources.get(sourceId);
    const resource = source?.url
      ? resourcesByUrl.get(normalizeUrl(source.url))
      : undefined;
    if (source?.title) sourceContext.push(source.title);
    if (resource) {
      sourceContext.push(resource.title, ...resource.sectionPath);
    }
    for (const sectionTitle of resource?.sectionPath ?? []) {
      const parsed = parseLearningSection(sectionTitle);
      const chapter = parsed
        ? bestChapterForSubject(parsed.subject, chapters)
        : chapterFromOrderHint(sectionTitle, chapters);
      if (chapter) {
        votes.set(chapter.id, (votes.get(chapter.id) ?? 0) + 1);
      }
    }
  }
  const voted = [...votes.entries()]
    .sort((left, right) => right[1] - left[1])[0]?.[0];
  if (voted) return voted;

  const scored = chapters
    .map((chapter) => ({
      chapter,
      score: subjectSimilarity(sourceContext.join(" "), chapter.subject),
    }))
    .sort((left, right) => right.score - left.score)[0];
  return scored && scored.score >= 0.24 ? scored.chapter.id : null;
}

function chapterFromOrderHint(
  sectionTitle: string,
  chapters: CourseChapter[],
): CourseChapter | null {
  const marker = /\beigenstudium\s+([A-Z]|\d+)\b/i.exec(sectionTitle)?.[1]?.toUpperCase();
  if (!marker) return null;
  const order = /^\d+$/.test(marker)
    ? Math.max(0, Number(marker) - 1)
    : Math.max(0, marker.charCodeAt(0) - "A".charCodeAt(0));
  return chapters.find((chapter) => chapter.order === order) ?? null;
}

function bestChapterForSubject(
  subject: string,
  chapters: CourseChapter[],
): CourseChapter | null {
  const scored = chapters
    .map((chapter) => ({ chapter, score: subjectSimilarity(subject, chapter.subject) }))
    .sort((left, right) => right.score - left.score)[0];
  return scored && scored.score >= 0.45 ? scored.chapter : null;
}

function parseLearningSection(value: string): {
  kind: "eigenstudium" | "praesenz";
  subject: string;
  order: number;
} | null {
  const match = /^\s*([A-Z]|\d+)\.?\s*(Eigenstudium|Präsenz|Praesenz)\s*[-–:]\s*(.+?)\s*$/i
    .exec(value);
  if (!match) return null;
  const marker = match[1].toUpperCase();
  const order = /^\d+$/.test(marker)
    ? Math.max(0, Number(marker) - 1)
    : Math.max(0, marker.charCodeAt(0) - "A".charCodeAt(0));
  return {
    kind: /^eigenstudium$/i.test(match[2]) ? "eigenstudium" : "praesenz",
    subject: match[3].replace(/\s+/g, " ").trim(),
    order,
  };
}

function subjectSimilarity(left: string, right: string): number {
  const leftTokens = subjectTokens(left);
  const rightTokens = subjectTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return intersection / Math.min(leftTokens.size, rightTokens.size);
}

function subjectTokens(value: string): Set<string> {
  const stopWords = new Set([
    "und",
    "oder",
    "der",
    "die",
    "das",
    "ein",
    "eine",
    "beispiele",
    "beispiel",
    "eigenstudium",
    "praesenz",
    "präsenz",
  ]);
  const tokens = normalizeSubject(value).match(/[a-z0-9äöüß]{3,}/g) ?? [];
  return new Set(
    tokens
      .filter((token) => !stopWords.has(token))
      .map(stemSubjectToken),
  );
}

function stemSubjectToken(token: string): string {
  if (token.length > 6 && token.endsWith("en")) return token.slice(0, -2);
  if (token.length > 6 && token.endsWith("e")) return token.slice(0, -1);
  return token;
}

function normalizeSubject(value: string): string {
  return value
    .toLocaleLowerCase("de")
    .normalize("NFKC")
    .replace(/[^a-z0-9äöüß]+/g, " ")
    .trim();
}

function chapterOrder(chapterId: string | null, chapters: CourseChapter[]): number {
  return chapters.find((chapter) => chapter.id === chapterId)?.order ?? Number.MAX_SAFE_INTEGER;
}

function isOrganizationalSection(heading: string): boolean {
  return /\b(?:kursidentifikation|prüfungstermin|pruefungstermin|prüfungsnavigator|pruefungsnavigator|exam navigator|kursabdeckung|lerncheckliste|stofflandkarte|quellenlage|quellenverzeichnis|vorbereitungsplan|priorisierte vorbereitung|selbsttest|kontrollfragen)\b/i
    .test(heading);
}

function isStudentFacingResource(
  resource: ResourceManifest["resources"][number],
): boolean {
  return (
    resource.status === "acquired" ||
    [
      "course",
      "resource",
      "file",
      "external",
      "video",
      "quiz",
      "assignment",
      "page",
      "book",
      "folder",
    ].includes(resource.activityType)
  );
}

function isOrganizationalConcept(concept: string): boolean {
  return /\b(?:alias|termin|datum|uhrzeit|raum|lektor|semester|moodle test \d+|seiten? \d+)\b/i
    .test(concept);
}

function firstSentence(summary: string): string {
  return summary.split(/(?<=[.!?])\s+/)[0].replace(/[.!?]+$/, "").trim();
}

function checklistItem(language: "de" | "en", goal: string, title: string): string {
  const normalized = goal
    .replace(/^(?:ich kann|i can)\s+/i, "")
    .replace(/[.!?]+$/, "")
    .trim();
  if (normalized.length >= 12) {
    const phrase = `${normalized.charAt(0).toLowerCase()}${normalized.slice(1)}.`;
    return language === "en" ? `I can ${phrase}` : `Ich kann ${phrase}`;
  }
  return language === "en"
    ? `I can explain and apply ${title} using the cited sources.`
    : `Ich kann ${title} anhand der belegten Quellen erklären und anwenden.`;
}

function inferPracticeLearningGoal(question: string): string {
  return `Die fachliche Fragestellung „${question.replace(/[?]+$/, "")}“ selbstständig beantworten.`;
}

function inferExampleLearningGoal(prompt: string): string {
  return `Das Vorgehen für „${prompt.replace(/[?]+$/, "") }“ nachvollziehen und auf ähnliche Aufgaben übertragen.`;
}

function stableId(value: string, prefix: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 12)}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}
