import { lookup } from "node:dns/promises";
import net from "node:net";

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
  if (parsed.protocol !== "https:") {
    throw new Error("URL must use HTTPS.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("URL must not contain embedded credentials.");
  }
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
  if (/^(?:fc|fd)/i.test(address) || /^fe[89ab]/i.test(address) || /^ff/i.test(address)) return true;
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
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b, c] = parts;
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
