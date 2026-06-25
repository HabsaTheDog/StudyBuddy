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
    [/[↘↙↗↖→←↓↑]/, "Do not use text arrow glyphs as diagram edges."],
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
