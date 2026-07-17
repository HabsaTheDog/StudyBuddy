import type { ResourceNode } from "./examNavigatorContracts.js";

export type ResourceStatus = ResourceNode["status"];
export type ResourceFailureKind = NonNullable<ResourceNode["failureKind"]>;

export interface ResourceFailureClassification {
  status: ResourceStatus;
  failureKind: ResourceFailureKind;
  recommendedAction: string;
}

export interface ResourcePayloadInspection {
  kind: "pdf" | "html" | "text" | "binary";
  contentType: string | null;
  title: string | null;
}

export function canonicalizeResourceUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of ["time", "forcedownload"]) url.searchParams.delete(key);
    return url.toString();
  } catch {
    return value;
  }
}

export function resourceLocators(title: string, url: string): string[] {
  const locators = new Set<string>();
  const pageRange = /\b(?:seite|pages?)\s+([A-Z]?\d+)\s*(?:bis|[-–])\s*([A-Z]?\d+)\b/i.exec(title);
  if (pageRange) locators.add(`pages:${pageRange[1]}-${pageRange[2]}`);
  try {
    const fragment = new URL(url).hash.slice(1).trim();
    if (fragment) locators.add(fragment);
  } catch {
    // The manifest will retain the title even when the URL is malformed.
  }
  return [...locators];
}

export function isKnownPdfEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return /\.pdf$/i.test(url.pathname) || /\/content\/pdf\//i.test(url.pathname);
  } catch {
    return false;
  }
}

export function isHanProxyUrl(value: string): boolean {
  try {
    return /(?:^|\.)han\.technikum-wien\.at$/i.test(new URL(value).hostname);
  } catch {
    return false;
  }
}

export function isResourceFailureStatus(status: ResourceStatus): boolean {
  return [
    "failed",
    "stale",
    "unauthorized",
    "not_found",
    "unsupported",
    "transient_failure",
    "tls_failure",
  ].includes(status);
}

export function inspectResourcePayload(
  body: Buffer,
  contentTypeHeader: string | undefined,
): ResourcePayloadInspection {
  const contentType = contentTypeHeader?.split(";", 1)[0]?.trim().toLowerCase() || null;
  const sample = body.subarray(0, Math.min(body.length, 16_384));
  const text = sample.toString("utf8");
  if (sample.indexOf(Buffer.from("%PDF-")) >= 0) {
    return { kind: "pdf", contentType, title: null };
  }
  if (/^\s*<!doctype html|^\s*<html[\s>]/i.test(text) || contentType?.includes("html")) {
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1]
      ?.replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim() || null;
    return { kind: "html", contentType, title };
  }
  if (contentType?.startsWith("text/") || /^(?:[\x09\x0A\x0D\x20-\x7E]|[\xC2-\xF4])/u.test(text)) {
    return { kind: "text", contentType, title: null };
  }
  return { kind: "binary", contentType, title: null };
}

export function classifyResourceFailure(
  message: string,
  input: { requestedUrl?: string; htmlTitle?: string | null; httpStatus?: number } = {},
): ResourceFailureClassification {
  const text = `${message} ${input.htmlTitle ?? ""}`;
  if (/unable to verify|self[- ]signed|certificate|cert(?:_| )/i.test(text)) {
    return {
      status: "tls_failure",
      failureKind: "tls",
      recommendedAction: "FHTW/HAN-CA-Zertifikat konfigurieren und diese Ressource gezielt erneut laden.",
    };
  }
  if (/Download job timed out|queue deadline|client-side deadline/i.test(text)) {
    return {
      status: "transient_failure",
      failureKind: "client_timeout",
      recommendedAction: "Lokales Zeitbudget prüfen und nur diese Ressource mit niedrigerer Parallelität erneut laden.",
    };
  }
  if (/operation was aborted|download job canceled|cancelled|canceled/i.test(text)) {
    return {
      status: "transient_failure",
      failureKind: "canceled",
      recommendedAction: "Nur erneut laden, wenn der übergeordnete Run nicht absichtlich abgebrochen wurde.",
    };
  }
  if (/time(?:d\s*out|out)|ETIMEDOUT/i.test(text)) {
    return {
      status: "transient_failure",
      failureKind: "remote_timeout",
      recommendedAction: "Remote-Quelle mit Backoff und niedrigerer Parallelität gezielt erneut laden.",
    };
  }
  if (input.httpStatus === 401 || input.httpStatus === 403 || /login required|access denied|forbidden|unauthori[sz]ed/i.test(text)) {
    return {
      status: "unauthorized",
      failureKind: "auth",
      recommendedAction: "Anmeldung oder Berechtigung für diese Quelle prüfen.",
    };
  }
  if (input.httpStatus === 404 || /\b404\b|not found|nicht gefunden/i.test(text)) {
    return {
      status: "not_found",
      failureKind: "not_found",
      recommendedAction: "Im aktuellen Moodle-Kurs nach einer gleichnamigen Ersatzressource suchen.",
    };
  }
  if (
    /Moodle returned an HTML page|Downloaded file is not a PDF/i.test(text) &&
    (/\b(?:SS|WS)20\d{2}\b/i.test(text) || input.requestedUrl?.includes("/mod/resource/"))
  ) {
    return {
      status: "stale",
      failureKind: "stale_resource",
      recommendedAction: "Veralteten Moodle-Verweis melden und im aktuellen Kurs nach dem Ersatz suchen.",
    };
  }
  if (/not a PDF|unexpected content|HTML page|missing PDF header/i.test(text)) {
    return {
      status: "unsupported",
      failureKind: "unexpected_content",
      recommendedAction: "Ressource anhand des tatsächlichen Inhaltstyps als HTML/Text statt als PDF verarbeiten.",
    };
  }
  if (/pdftotext|tesseract|OCR|text extraction|extract(?:ion|ing) failed/i.test(text)) {
    return {
      status: "unsupported",
      failureKind: "extraction",
      recommendedAction: "Extraktionswerkzeuge installieren oder die betroffene Datei mit OCR erneut verarbeiten.",
    };
  }
  if (input.httpStatus && input.httpStatus >= 500) {
    return {
      status: "transient_failure",
      failureKind: "http",
      recommendedAction: "Serverfehler später mit Backoff erneut versuchen.",
    };
  }
  if (/fetch failed|ECONN|network|socket|DNS/i.test(text)) {
    return {
      status: "transient_failure",
      failureKind: "network",
      recommendedAction: "Netzwerkzugriff prüfen und diese Ressource gezielt erneut laden.",
    };
  }
  return {
    status: "failed",
    failureKind: "unknown",
    recommendedAction: "Fehlerdetails prüfen und nur diese Ressource gezielt erneut laden.",
  };
}

export function formatResourceFailureBlock(input: {
  title: string;
  url: string;
  message: string;
  resolvedUrl?: string | null;
  contentType?: string | null;
  htmlTitle?: string | null;
  httpStatus?: number;
}): string {
  const classification = classifyResourceFailure(input.message, {
    requestedUrl: input.url,
    htmlTitle: input.htmlTitle,
    httpStatus: input.httpStatus,
  });
  return [
    "[Linked file]",
    `Title: ${input.title}`,
    `URL: ${input.url}`,
    input.resolvedUrl ? `Resolved URL: ${input.resolvedUrl}` : null,
    input.contentType ? `Content-Type: ${input.contentType}` : null,
    `Resource status: ${classification.status}`,
    `Failure kind: ${classification.failureKind}`,
    `Suggested action: ${classification.recommendedAction}`,
    `Download failed: ${input.message}`,
  ].filter((line): line is string => Boolean(line)).join("\n");
}
