import { STUDY_BUDDY_COMPONENTS_FILE } from "./typstTemplate.js";

export interface TypstStructureValidation {
  ok: boolean;
  errors: string[];
}

export function validateStudyBuddyDocumentStructure(source: string): TypstStructureValidation {
  const errors: string[] = [];
  const importPattern = new RegExp(
    String.raw`#import\s+"${escapeRegExp(STUDY_BUDDY_COMPONENTS_FILE)}"\s*:\s*\*`,
    "g",
  );
  const componentImports = source.match(importPattern) ?? [];
  if (componentImports.length !== 1) {
    errors.push(
      `Import ${STUDY_BUDDY_COMPONENTS_FILE} exactly once with '#import "${STUDY_BUDDY_COMPONENTS_FILE}": *'.`,
    );
  }

  const documentCalls = source.match(/#sb-document\s*\(/g) ?? [];
  if (documentCalls.length !== 1) {
    errors.push("Use exactly one #sb-document(...) shell.");
  }

  for (const field of ["title", "short-title", "course", "kind", "semester", "status", "date"]) {
    if (!new RegExp(String.raw`\b${escapeRegExp(field)}\s*:`).test(source)) {
      errors.push(`The #sb-document shell is missing the '${field}:' field.`);
    }
  }

  const prohibitedPatterns: Array<[RegExp, string]> = [
    [/#set\s+page\s*\(/, "Do not override page settings; sb-document owns the page layout."],
    [/#set\s+text\s*\(/, "Do not override global typography; sb-document owns typography."],
    [/#(?:table|grid)\s*\(/, "Use the approved sb-table components instead of raw table/grid calls."],
    [/#(?:rect|line|circle|polygon)\s*\(/, "Do not draw raw geometry in a generated document."],
    [/\bcetz\.canvas\s*\(/, "Do not use inline CeTZ; use the approved diagram components."],
    [/@preview\/cetz|@local\/cetz/, "Do not import CeTZ directly in generated documents."],
    [/[┌┐└┘├┤┬┴┼─│]/, "Do not use box-drawing or ASCII-art diagrams."],
  ];
  for (const [pattern, message] of prohibitedPatterns) {
    if (pattern.test(source)) {
      errors.push(message);
    }
  }

  if (/#sb-rc-schematic\s*\(/.test(source) && !/RC|Tiefpass|low-pass/i.test(source)) {
    errors.push("Use sb-rc-schematic only for an explicitly identified RC low-pass.");
  }

  if (/#sb-formula\s*\([\s\S]*?\)\s*\[[\s\S]{0,1600}#raw\s*\(/.test(source)) {
    errors.push("Do not use #raw(...) inside #sb-formula; formula bodies must use editable Typst math delimited with '$'.");
  }

  const textStringCalls = source.matchAll(/#text\s*\(\s*"((?:\\.|[^"\\])*)"\s*\)/g);
  for (const textCall of textStringCalls) {
    const visibleText = textCall[1];
    if (/\$[^$\n]*(?:=|[_^]|\\(?:frac|sqrt|Delta|sigma|tau)\b)[^$\n]*\$/.test(visibleText)) {
      errors.push(
        "Do not place '$...$' math markup inside #text(\"...\"); render it as editable Typst math instead.",
      );
      break;
    }
  }

  const calloutCount = (source.match(/#sb-callout\s*\(/g) ?? []).length;
  const levelOneCount = (source.match(/#heading\s*\(\s*level:\s*1\s*\)/g) ?? []).length;
  if (calloutCount > Math.max(3, levelOneCount)) {
    errors.push("Use callouts sparingly; do not turn routine content, review questions, or repeated warnings into boxed callouts.");
  }
  if (hasAdjacentComponent(source, "sb-callout")) {
    errors.push("Do not place #sb-callout blocks directly after each other; merge related warnings or separate them with prose.");
  }

  const checklistCount = (source.match(/#sb-checklist\s*\(/g) ?? []).length;
  if (checklistCount > 2) {
    errors.push("Use at most two #sb-checklist blocks; use ordinary bullet or numbered lists for concepts, procedures, and examples.");
  }
  if (/#heading\s*\(\s*level:\s*2\s*\)\s*\[\s*#text\s*\(\s*"Kernpunkte"\s*\)\s*\][\s\S]{0,500}#sb-checklist\s*\(/.test(source)) {
    errors.push("Do not render chapter 'Kernpunkte' as #sb-checklist; use prose, ordinary bullets, or a table.");
  }

  const imageCalls = [...source.matchAll(/#image\s*\(\s*"([^"]+)"/g)];
  for (const imageCall of imageCalls) {
    const imagePath = imageCall[1];
    if (!imagePath.startsWith("assets/visuals/") || imagePath.includes("..")) {
      errors.push(`Image paths must stay inside assets/visuals/: ${imagePath}`);
    }
  }
  if (imageCalls.length > 0 && !/#sb-figure\s*\([\s\S]*?\)\s*\[[\s\S]*#image\s*\(/.test(source)) {
    errors.push("Use #image(...) only inside #sb-figure(...)[...].");
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

function hasAdjacentComponent(source: string, componentName: string): boolean {
  const ranges = componentBlockRanges(source, componentName);
  for (let index = 0; index < ranges.length - 1; index += 1) {
    const between = source.slice(ranges[index].end, ranges[index + 1].start).trim();
    if (between === "" || /^#v\s*\([^)]*\)\s*$/.test(between)) {
      return true;
    }
  }
  return false;
}

function componentBlockRanges(source: string, componentName: string): Array<{ start: number; end: number }> {
  const pattern = new RegExp(String.raw`#${componentName}\s*\(`, "g");
  const ranges: Array<{ start: number; end: number }> = [];
  for (const match of source.matchAll(pattern)) {
    const start = match.index ?? 0;
    const parenOpen = source.indexOf("(", start);
    const parenClose = findMatching(source, parenOpen, "(", ")");
    if (parenClose === -1) {
      ranges.push({ start, end: start + match[0].length });
      continue;
    }
    const bracketOpen = nextNonWhitespaceIndex(source, parenClose + 1);
    if (source[bracketOpen] !== "[") {
      ranges.push({ start, end: parenClose + 1 });
      continue;
    }
    const bracketClose = findMatching(source, bracketOpen, "[", "]");
    ranges.push({ start, end: bracketClose === -1 ? bracketOpen + 1 : bracketClose + 1 });
  }
  return ranges;
}

function findMatching(source: string, openIndex: number, open: string, close: string): number {
  if (openIndex < 0 || source[openIndex] !== open) {
    return -1;
  }
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === open) {
      depth += 1;
    } else if (source[index] === close) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function nextNonWhitespaceIndex(source: string, start: number): number {
  let index = start;
  while (index < source.length && /\s/.test(source[index])) {
    index += 1;
  }
  return index;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
