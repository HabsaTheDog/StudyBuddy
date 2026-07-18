/**
 * Prevent a known Codex SDK shutdown race from printing an unhandled EPIPE
 * stack after an intentionally aborted child process. Other uncaught errors
 * retain Node's default fatal behaviour.
 */
export function installCliBrokenPipeGuard(): void {
  const onUncaughtException = (error: unknown) => {
    if (isBrokenPipeError(error)) {
      process.exitCode ??= 1;
      return;
    }

    process.off("uncaughtException", onUncaughtException);
    throw error;
  };

  process.on("uncaughtException", onUncaughtException);
}

export function isBrokenPipeError(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "EPIPE";
}
