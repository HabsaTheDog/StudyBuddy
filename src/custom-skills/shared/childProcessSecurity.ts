const CHILD_ENV_ALLOWLIST = new Set([
  "PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL",
  "DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY", "XDG_RUNTIME_DIR", "SSL_CERT_FILE", "SSL_CERT_DIR",
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
