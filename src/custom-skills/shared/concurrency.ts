const DEFAULT_MAX_CONCURRENCY = 128;

/**
 * Resolve an optional process-wide concurrency throttle.
 *
 * Missing, zero, and explicit "unlimited" values disable the throttle so
 * independent Study Buddy processes can run in parallel. Positive integers
 * opt into a bounded shared queue.
 */
export function resolveOptionalConcurrency(
  value: string | number | undefined,
  maximum = DEFAULT_MAX_CONCURRENCY,
): number | null {
  if (value === undefined) return null;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized || ["0", "unlimited", "none", "off", "disabled"].includes(normalized)) {
      return null;
    }
    value = Number(normalized);
  }
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.min(Math.max(1, Math.floor(value)), Math.max(1, Math.floor(maximum)));
}
