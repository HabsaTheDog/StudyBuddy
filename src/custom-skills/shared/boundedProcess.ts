import { spawn } from "node:child_process";
import path from "node:path";

export interface BoundedProcessOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxOutputBytes?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface BoundedProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export function runBoundedProcess(
  command: string,
  args: readonly string[],
  options: BoundedProcessOptions = {},
): Promise<BoundedProcessResult> {
  const timeoutMs = options.timeoutMs ?? 90_000;
  const maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024;
  if (options.signal?.aborted) {
    return Promise.reject(options.signal.reason instanceof Error
      ? options.signal.reason
      : new Error(`${path.basename(command)} canceled.`));
  }
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const label = path.basename(command);
    let settled = false;
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let terminalError: Error | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    let commandTimer: NodeJS.Timeout | undefined;

    const cleanup = () => {
      if (killTimer) clearTimeout(killTimer);
      if (commandTimer) clearTimeout(commandTimer);
      options.signal?.removeEventListener("abort", abort);
    };
    const fail = (error: Error) => {
      if (settled || terminalError) return;
      terminalError = error;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 1_000);
    };
    const abort = () => fail(
      options.signal?.reason instanceof Error
        ? options.signal.reason
        : new Error(`${label} canceled.`),
    );

    options.signal?.addEventListener("abort", abort, { once: true });
    if (timeoutMs > 0) {
      commandTimer = setTimeout(
        () => fail(new Error(`${label} timed out after ${timeoutMs}ms.`)),
        timeoutMs,
      );
    }

    child.stdout.on("data", (chunk: Buffer) => {
      if (settled) return;
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > maxOutputBytes) {
        fail(new Error(`${label} exceeded the ${maxOutputBytes}-byte stdout safety limit.`));
        return;
      }
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (settled) return;
      stderrBytes += chunk.byteLength;
      if (stderrBytes > maxOutputBytes) {
        fail(new Error(`${label} exceeded the ${maxOutputBytes}-byte stderr safety limit.`));
        return;
      }
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    child.on("close", (code) => {
      cleanup();
      if (settled) return;
      settled = true;
      if (terminalError) {
        reject(terminalError);
      } else {
        resolve({ code, stdout, stderr });
      }
    });
  });
}
