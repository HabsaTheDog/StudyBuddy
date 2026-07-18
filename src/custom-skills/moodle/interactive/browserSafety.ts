import type { AgentBrowserRef } from "./agentBrowserClient.js";

const FINAL_SUBMIT_TEXT_PATTERNS = [
  /submit all and finish/i,
  /confirm submission/i,
  /final submit/i,
  /alles? abgeben/i,
  /abgabe best(?:ä|ae)tigen/i,
  /endg(?:ü|ue)ltig absenden/i,
];

export interface SnapshotLink {
  ref: string;
  href: string;
  label: string;
  role: string;
}

export function assertSafeClick(label: string): void {
  if (isFinalSubmitClickLabel(label)) {
    throw new Error(`Blocked final Moodle submission control "${label}".`);
  }
}

export function isFinalSubmitClickLabel(label: string): boolean {
  return FINAL_SUBMIT_TEXT_PATTERNS.some((pattern) => pattern.test(label));
}

export function isAuthFailure(message: string): boolean {
  return /auth|credential|zugangsdaten|anmeldung|login/i.test(message);
}

export function browserRefSelector(ref: string): string {
  return ref.startsWith("@") ? ref : `@${ref}`;
}

export function extractLinksFromSnapshot(
  snapshot: string,
  refs: Record<string, AgentBrowserRef>,
): SnapshotLink[] {
  const links: SnapshotLink[] = [];
  for (const line of snapshot.split("\n")) {
    const ref = /ref=([a-z0-9_-]+)/i.exec(line)?.[1];
    const refData = ref ? (refs[ref] ?? {}) : {};
    const href = refData.href || /url=([^\]\s,]+)/i.exec(line)?.[1];
    if (!ref || !href) {
      continue;
    }
    const role = refData.role || (/^- ([a-z]+)/i.exec(line)?.[1] ?? "");
    const label = refData.name || /"([^"]+)"/.exec(line)?.[1] || href;
    links.push({ ref, href, label, role });
  }
  return links;
}

export function snapshotToText(snapshot: string): string {
  return snapshot
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*[-|`]+\s*/, "")
        .replace(/\s*\[[^\]]*\]\s*/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join("\n");
}

export function safeFileName(value: string): string {
  return (
    value
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "source"
  );
}

export function hasBodyText(chunk: string): boolean {
  const [, , , ...body] = chunk.split("\n");
  return body.join("\n").trim().length > 0;
}
