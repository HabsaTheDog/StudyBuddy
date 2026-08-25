const CHILD_ENV_ALLOWLIST = new Set([
  "PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL",
  "DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY", "XDG_RUNTIME_DIR", "SSL_CERT_FILE", "SSL_CERT_DIR",
]);

const CODEX_ENV_ALLOWLIST = new Set([
  ...CHILD_ENV_ALLOWLIST,
  "CODEX_HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
]);

export function assertNoSensitiveCommandArguments(
  args: readonly string[],
  sensitiveValues: readonly string[],
): void {
  const exposed = sensitiveValues.find(
    (secret) => secret.length > 0 && args.some((argument) => argument.includes(secret)),
  );
  if (exposed) {
    throw new Error("Blocked a child-process command that would expose a credential in argv.");
  }
}

export function buildCredentialFreeChildEnvironment(
  source: NodeJS.ProcessEnv,
  sensitiveValues: readonly string[],
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(source).filter(([key, value]) => {
      if (!CHILD_ENV_ALLOWLIST.has(key)) return false;
      if (/(?:PASSWORD|PASSWD|TOKEN|SECRET|API_?KEY|CREDENTIAL|CALENDAR_URL)$/i.test(key)) return false;
      return !sensitiveValues.some(
        (secret) => secret.length > 0 && (value?.includes(secret) ?? false),
      );
    }),
  );
}

/**
 * Build the complete environment for Codex SDK/CLI children. Provider login
 * state belongs in CODEX_HOME; portal credentials and arbitrary host secrets
 * must never be inherited by Codex or captured in its shell snapshots.
 */
export function buildCodexChildEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const environment = Object.fromEntries(
    Object.entries(source).flatMap(([key, value]) =>
      CODEX_ENV_ALLOWLIST.has(key) && value ? [[key, value] as const] : [],
    ),
  );
  // Packaged desktop workflows execute JavaScript CLIs with Electron's binary.
  // The executable path itself stays out of the child environment, but its
  // presence is an explicit desktop-owned signal that Electron must run as
  // Node. Arbitrary host ELECTRON_RUN_AS_NODE values remain filtered.
  if (source.STUDY_BUDDY_NODE_EXECUTABLE?.trim()) {
    environment.ELECTRON_RUN_AS_NODE = "1";
  }
  return environment;
}

export function buildCodexShellEnvironmentConfig(environment: Record<string, string>) {
  return {
    shell_environment_policy: {
      inherit: "none" as const,
      set: {
        PATH: environment.PATH ?? "",
        LANG: environment.LANG ?? environment.LC_ALL ?? "C.UTF-8",
      },
    },
  };
}
