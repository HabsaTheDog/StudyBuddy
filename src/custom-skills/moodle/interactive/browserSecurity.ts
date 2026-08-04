// @effect-diagnostics nodeBuiltinImport:off
import { lookup } from "node:dns/promises";
import net from "node:net";

export type BrowserAuthenticationState =
  | "discovery"
  | "auth-locked"
  | "user-action-required"
  | "authenticated"
  | "failed";

export class BrowserAuthenticationLockedError extends Error {
  constructor(operation: string) {
    super(`Browser ${operation} is unavailable while authentication is locked.`);
    this.name = "BrowserAuthenticationLockedError";
  }
}

/**
 * Tracks the authentication transaction independently from the page DOM. Once
 * credential injection starts, page content must not leave the browser worker
 * until authentication reaches a terminal state.
 */
export class BrowserAuthenticationGate {
  #state: BrowserAuthenticationState = "discovery";

  get state(): BrowserAuthenticationState {
    return this.#state;
  }

  lock(): void {
    if (this.#state === "auth-locked" || this.#state === "user-action-required") return;
    if (this.#state !== "discovery") {
      throw new Error(`Cannot start authentication from ${this.#state}.`);
    }
    this.#state = "auth-locked";
  }

  requireUserAction(): void {
    if (this.#state !== "auth-locked") {
      throw new Error(`Cannot request user authentication action from ${this.#state}.`);
    }
    this.#state = "user-action-required";
  }

  authenticate(): void {
    if (this.#state !== "auth-locked" && this.#state !== "user-action-required") {
      throw new Error(`Cannot complete authentication from ${this.#state}.`);
    }
    this.#state = "authenticated";
  }

  fail(): void {
    if (this.#state !== "authenticated") this.#state = "failed";
  }

  assertReadable(operation = "snapshot"): void {
    if (this.#state === "auth-locked" || this.#state === "user-action-required") {
      throw new BrowserAuthenticationLockedError(operation);
    }
  }
}

const SENSITIVE_FIELD_LINE =
  /^\s*((?:password|passwd|passcode|secret|token|authorization|credential|current-password)(?:\s+(?:value|text|name))?\s*[:=]\s*)(.*)$/gim;
const CREDENTIAL_URL_PARAMETER =
  /([?&](?:access[_-]?token|refresh[_-]?token|sesskey|token|secret|password|passwd|passcode|api[_-]?key|auth|authorization|credential|signature|code|key)[^=&#]*=)[^&#\s"'<>]*/gi;
const CREDENTIAL_MASK = /(?:[•●▪◦]\s*){2,}|\*{3,}/g;

function variants(value: string): string[] {
  if (!value) return [];
  const output = new Set([value]);
  try {
    output.add(encodeURIComponent(value));
  } catch {
    // Exact-value redaction still applies.
  }
  return [...output].filter((candidate) => candidate.length >= 3);
}

/** Defense-in-depth redaction for every model-visible browser/string result. */
export function redactSensitiveValues(
  input: string,
  sensitiveValues: ReadonlyArray<string | undefined>,
): string {
  let output = input;
  for (const secret of sensitiveValues) {
    if (!secret) continue;
    for (const candidate of variants(secret)) {
      output = output.split(candidate).join("[REDACTED_CREDENTIAL]");
    }
  }
  return output
    .replace(CREDENTIAL_URL_PARAMETER, "$1[REDACTED]")
    .replace(SENSITIVE_FIELD_LINE, "$1[REDACTED]");
}

export function sanitizeModelVisibleUrl(
  input: string,
  sensitiveValues: ReadonlyArray<string | undefined> = [],
): string {
  try {
    const url = new URL(redactSensitiveValues(input, sensitiveValues));
    url.username = "";
    url.password = "";
    url.hash = "";
    for (const key of url.searchParams.keys()) {
      if (/(?:access[_-]?token|refresh[_-]?token|sesskey|token|secret|password|passwd|passcode|api[_-]?key|auth|authorization|credential|signature|code|key)/i.test(key)) {
        url.searchParams.set(key, "[REDACTED]");
      }
    }
    return url.toString();
  } catch {
    return "[REDACTED_URL]";
  }
}

export function hasExactOrigin(value: string, expectedOrigin: string): boolean {
  try {
    return new URL(value).origin === new URL(expectedOrigin).origin;
  } catch {
    return false;
  }
}

export async function assertPublicHttpsUrl(
  value: string,
  resolveHostname: (hostname: string) => Promise<string[]> = resolveAllAddresses,
): Promise<void> {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") throw new Error("URL must use HTTPS.");
  if (isDisallowedHostname(parsed.hostname)) {
    throw new Error("URL resolves to a local or private network address.");
  }
  if (net.isIP(stripIpv6Brackets(parsed.hostname)) === 0) {
    const addresses = await resolveHostname(parsed.hostname);
    if (addresses.length === 0 || addresses.some(isDisallowedAddress)) {
      throw new Error("URL resolves to a local or private network address.");
    }
  }
}

export function isDisallowedAddress(value: string): boolean {
  const address = stripIpv6Brackets(value).toLowerCase();
  const version = net.isIP(address);
  if (version === 4) return isDisallowedIpv4(address);
  if (version !== 6) return true;
  if (address === "::" || address === "::1") return true;
  if (/^(?:fc|fd)/i.test(address) || /^fe[89ab]/i.test(address) || /^ff/i.test(address))
    return true;
  if (/^2001:db8(?::|$)/i.test(address)) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  return mapped ? isDisallowedIpv4(mapped) : false;
}

function isDisallowedHostname(value: string): boolean {
  const hostname = stripIpv6Brackets(value).toLowerCase().replace(/\.$/, "");
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    (net.isIP(hostname) !== 0 && isDisallowedAddress(hostname))
  );
}

function isDisallowedIpv4(value: string): boolean {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
    return true;
  const a = parts[0]!;
  const b = parts[1]!;
  const c = parts[2]!;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

async function resolveAllAddresses(hostname: string): Promise<string[]> {
  return (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);
}

function stripIpv6Brackets(value: string): string {
  return value.replace(/^\[|\]$/g, "");
}

export interface SanitizableBrowserSnapshot {
  origin: string;
  refs: Record<string, { role?: string; name?: string; href?: string }>;
  snapshot: string;
}

export function isAuthenticationSnapshot(snapshot: SanitizableBrowserSnapshot): boolean {
  try {
    const path = new URL(snapshot.origin).pathname;
    if (/\/(?:login|signin|sign-in|auth|sso|mfa|captcha|verify)(?:[/.?_-]|$)/i.test(path)) {
      return true;
    }
  } catch {
    return true;
  }
  return Object.values(snapshot.refs).some((ref) =>
    /(?:password|passwd|passcode|current-password|one-time-code|captcha)/i.test(
      `${ref.role ?? ""} ${ref.name ?? ""}`,
    ),
  );
}

/**
 * Produces a new object so callers cannot retain a raw snapshot by reference.
 * Password/credential fields expose state only, never a value or bullet count.
 */
export function sanitizeBrowserSnapshot<T extends SanitizableBrowserSnapshot>(
  snapshot: T,
  sensitiveValues: ReadonlyArray<string | undefined>,
): T {
  const refs = Object.fromEntries(
    Object.entries(snapshot.refs).map(([key, ref]) => {
      const name = redactSensitiveValues(ref.name ?? "", sensitiveValues);
      const sensitive =
        /(?:password|passwd|passcode|secret|token|credential)/i.test(`${ref.role ?? ""} ${name}`) ||
        CREDENTIAL_MASK.test(name);
      CREDENTIAL_MASK.lastIndex = 0;
      return [
        key,
        {
          ...(ref.role ? { role: ref.role } : {}),
          ...(name ? { name: sensitive ? "Credential" : name } : {}),
          ...(ref.href ? { href: sanitizeModelVisibleUrl(ref.href, sensitiveValues) } : {}),
          ...(sensitive ? { name: "Credential", sensitive: true, state: "credential-field" } : {}),
        },
      ];
    }),
  );
  return {
    ...snapshot,
    origin: sanitizeModelVisibleUrl(snapshot.origin, sensitiveValues),
    refs,
    snapshot: redactSensitiveValues(snapshot.snapshot, sensitiveValues)
      .replace(CREDENTIAL_MASK, "[CREDENTIAL_STATE_REDACTED]")
      .replace(
        /(textbox|input)[^\n]*(?:password|passwd|passcode|secret|token|credential)[^\n]*/gi,
        '$1 "Credential" [sensitive=true, state=credential-field]',
      ),
  } as T;
}
