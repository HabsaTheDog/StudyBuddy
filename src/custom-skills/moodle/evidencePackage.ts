import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  EvidencePackageSchema,
  type EvidencePackage,
  type EvidenceRecord,
  type ResourceManifest,
} from "./examNavigatorContracts.js";
import { stableResourceId } from "./resourceManifest.js";

export const EVIDENCE_PACKAGE_FILE = "evidence-package.json";

export async function buildEvidencePackage(
  runDir: string,
  rawText: string,
  manifest: ResourceManifest,
): Promise<EvidencePackage> {
  const records: EvidenceRecord[] = [];
  const warnings: string[] = [];
  const blocks = rawText.split(/\n(?=\[(?:Moodle page|Linked file|Calendar|CIS))/g);

  for (const block of blocks) {
    const sourceUrl = /^URL:\s*(\S+)/m.exec(block)?.[1] ?? null;
    const localPath = /^Saved path:\s*(.+)$/m.exec(block)?.[1]?.trim() ?? null;
    const title = /^Title:\s*(.+)$/m.exec(block)?.[1]?.trim() ?? "Source";
    const resourceId = sourceUrl
      ? stableResourceId(sourceUrl)
      : manifest.resources.find((resource) => resource.localPath === localPath)?.id ??
        stableTextId(`${title}:${localPath ?? "inline"}`, "res");
    const content = stripBlockMetadata(block);
    if (!content.trim()) continue;
    const kind = evidenceKind(title);
    const pairId = exercisePairId(title);
    for (const [index, chunk] of meaningfulChunks(content).entries()) {
      records.push({
        id: stableTextId(`${resourceId}:${kind}:${index}:${chunk}`, "ev"),
        resourceId,
        kind,
        locator: {
          section: title,
          page: pageFromText(chunk),
        },
        content: chunk,
        confidence: sourceUrl || localPath ? 0.95 : 0.75,
        pairId,
        sourceUrl,
        localPath,
      });
    }
  }

  if (manifest.resources.some((resource) => resource.status === "failed")) {
    warnings.push("Einzelne entdeckte Ressourcen konnten nicht geladen werden und wurden nicht als Evidenz verwendet.");
  }
  if (records.length === 0) {
    warnings.push("Es wurden keine nutzbaren fachlichen Evidenzabschnitte extrahiert.");
  }

  const evidence = EvidencePackageSchema.parse({
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    records: deduplicateEvidence(records),
    warnings,
  });
  await writeFile(
    path.join(runDir, EVIDENCE_PACKAGE_FILE),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
  return evidence;
}

function stripBlockMetadata(block: string): string {
  return block
    .replace(/^\[[^\]]+\]\s*/m, "")
    .replace(/^Title:\s*.+$/m, "")
    .replace(/^URL:\s*.+$/m, "")
    .replace(/^Saved path:\s*.+$/m, "")
    .replace(/^Download failed.*$/m, "")
    .trim();
}

function meaningfulChunks(content: string): string[] {
  const paragraphs = content
    .split(/\n{2,}/)
    .flatMap((paragraph) => paragraph.length > 12_000 ? splitLongText(paragraph, 8_000) : [paragraph])
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter((paragraph) => paragraph.length >= 24)
    .filter((paragraph) => !/^(?:navigation|dashboard|startseite|site-navigation)$/i.test(paragraph));
  return paragraphs.length > 0 ? paragraphs : [content.trim()].filter(Boolean);
}

function splitLongText(value: string, size: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < value.length; index += size) {
    chunks.push(value.slice(index, index + size));
  }
  return chunks;
}

function evidenceKind(title: string): EvidenceRecord["kind"] {
  if (/\b(?:lösung|loesung|solution)\b/i.test(title)) return "solution";
  if (/\b(?:angabe|aufgabe|exercise|rechenbeispiel)\b/i.test(title)) return "exercise";
  if (/\b(?:formel|formula)\b/i.test(title)) return "formula";
  if (/\b(?:tabelle|table)\b/i.test(title)) return "table";
  if (/\b(?:definition)\b/i.test(title)) return "definition";
  return "claim";
}

function exercisePairId(title: string): string | null {
  const match = /\b(?:angabe|lösung|loesung|solution|aufgabe|rechenbeispiel)\s*([a-z]|\d+)\b/i.exec(title);
  return match ? `pair_${match[1].toLowerCase()}` : null;
}

function pageFromText(text: string): number | undefined {
  const match = /\b(?:seite|page)\s+(\d+)\b/i.exec(text);
  const page = match ? Number(match[1]) : NaN;
  return Number.isInteger(page) && page > 0 ? page : undefined;
}

function deduplicateEvidence(records: EvidenceRecord[]): EvidenceRecord[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    const key = `${record.resourceId}:${record.kind}:${record.content}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stableTextId(value: string, prefix: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}
