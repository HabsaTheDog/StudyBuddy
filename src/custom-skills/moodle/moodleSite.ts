const MOODLE_PATH_HINT =
  /\/(?:course\/view\.php|mod\/[a-z0-9_-]+\/view\.php|pluginfile\.php|my\/?)(?:[/?#]|$)/i;
const MOODLE_ROUTE_MARKER =
  /\/(?:course\/view\.php|course\/section\.php|mod\/[a-z0-9_-]+\/view\.php|pluginfile\.php|draftfile\.php|login\/index\.php|my\/?)(?:[/?#]|$)/i;

export function isMoodleDashboardUrl(value: string): boolean {
  try {
    const pathname = normalizedPathname(new URL(value).pathname);
    return pathname === "/" || /(?:^|\/)my\/$/i.test(pathname);
  } catch {
    return false;
  }
}

export function normalizeMoodleDashboardUrl(value: string): string {
  try {
    const url = new URL(value);
    if (/(?:^|\/)my$/i.test(url.pathname)) url.pathname = `${url.pathname}/`;
    return url.toString();
  } catch {
    return value;
  }
}

export function dashboardUrlForMoodle(value: string): string {
  try {
    const url = new URL(value);
    if (isMoodleDashboardUrl(url.toString())) {
      return normalizeMoodleDashboardUrl(url.toString());
    }
    url.pathname = `${moodleInstallationPath(url.pathname)}/my/`.replace(/\/{2,}/g, "/");
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

export function extractMoodleUrlFromText(text: string): string | null {
  const urls = text.match(/https:\/\/[^\s<>)"']+/gi) ?? [];
  for (const raw of urls) {
    const candidate = raw.replace(/[.,;:!?]+$/g, "");
    try {
      const parsed = new URL(candidate);
      if (
        parsed.hostname.toLowerCase().includes("moodle") ||
        MOODLE_PATH_HINT.test(parsed.pathname)
      ) {
        return parsed.toString();
      }
    } catch {
      // Continue to the next URL; malformed prompt text is not a target.
    }
  }
  return null;
}

export function isLikelyMoodleUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      parsed.hostname.toLowerCase().includes("moodle") ||
      MOODLE_PATH_HINT.test(parsed.pathname) ||
      /\/(?:login\/index\.php|course\/section\.php|draftfile\.php)(?:[/?#]|$)/i
        .test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

export function isSameMoodleOrigin(value: string, moodleBaseUrl: string): boolean {
  try {
    return new URL(value).origin === new URL(moodleBaseUrl).origin;
  } catch {
    return false;
  }
}

export function isExternalToMoodle(value: string, moodleBaseUrl: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      !isSameMoodleOrigin(parsed.toString(), moodleBaseUrl)
    );
  } catch {
    return false;
  }
}

export function deriveMoodleBrowserDomains(
  moodleBaseUrl: string,
  additionalUrls: Array<string | undefined> = [],
): string[] {
  const hosts = [moodleBaseUrl, ...additionalUrls].flatMap((value) => {
    if (!value) return [];
    try {
      return [new URL(value).hostname];
    } catch {
      return [];
    }
  });
  return [...new Set(hosts)];
}

export function normalizeMoodleCourseTitle(value: string): string {
  return normalizeMoodleCourseIdentity(value).title;
}

export interface MoodleCourseIdentity {
  title: string;
  code?: string;
}

/**
 * Separates the actual course identity from Moodle dashboard-card chrome.
 *
 * Moodle themes commonly expose one flattened link label containing the
 * catalogue key, title, lecturers, and the learner's role. Persisting that
 * string as a title leaks UI metadata into every downstream PDF/HTML and makes
 * a generic first-token heuristic report programme codes such as `BMR` as the
 * course code. Keep this parser theme-tolerant and deterministic; a clean page
 * title remains the preferred source whenever it is available.
 */
export function normalizeMoodleCourseIdentity(value: string): MoodleCourseIdentity {
  let normalized = value
    .replace(/^\s*(?:course|kurs)\s*:\s*/i, "")
    .replace(/\s+\|\s+.*$/u, "")
    .replace(
      /\s+(?:(?:lektor|lecturer)(?:in|innen|:in|:innen|s)?|lehrende|verantwortlich|responsible|instructor(?:s)?)\s*:\s*.*$/iu,
      "",
    )
    .replace(/\s+(?:ihre\s+rolle|your\s+role)\s*:\s*.*$/iu, "")
    .replace(/\s+/g, " ")
    .trim();

  const cataloguePrefix = /^([A-Z0-9ÄÖÜ]+(?:-[A-Z0-9ÄÖÜ]+){3,})(?:\/\d+)*\s+(.+)$/u.exec(normalized);
  if (!cataloguePrefix) return { title: normalized };

  const segments = cataloguePrefix[1]!.split("-");
  const languageSuffix = /^(?:DE|EN|FR|ES|IT)$/i.test(segments.at(-1) ?? "");
  const code = (languageSuffix ? segments.at(-2) : segments.at(-1))?.trim();
  normalized = cataloguePrefix[2]!.trim();
  return {
    title: normalized,
    ...(code ? { code } : {}),
  };
}

/**
 * Returns the path prefix below which Moodle is installed. Standard deployments
 * use the origin root, while hosted or shared servers commonly use `/moodle`,
 * `/campus/moodle`, or a similar prefix.
 */
export function moodleInstallationPath(pathname: string): string {
  const normalized = normalizedPathname(pathname);
  const marker = MOODLE_ROUTE_MARKER.exec(normalized);
  if (!marker) return "";
  return normalized.slice(0, marker.index).replace(/\/+$/g, "");
}

function normalizedPathname(pathname: string): string {
  const withLeadingSlash = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return withLeadingSlash.replace(/\/{2,}/g, "/");
}
