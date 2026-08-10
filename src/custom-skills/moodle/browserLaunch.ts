import { chromium, type Browser, type LaunchOptions } from "playwright";
import { StudyBuddyTimeoutError, raceWithAbort, throwIfAborted } from "./runtimeAbort.js";

const DEFAULT_BROWSER_LAUNCH_TIMEOUT_MS = 30_000;

export interface MoodleBrowserLauncher {
  launch(options: LaunchOptions): Promise<Browser>;
}

export async function launchMoodleBrowser(input: {
  headless: boolean;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  purpose?: string;
  launcher?: MoodleBrowserLauncher;
}): Promise<Browser> {
  throwIfAborted(input.abortSignal);
  const timeoutMs = input.timeoutMs ?? DEFAULT_BROWSER_LAUNCH_TIMEOUT_MS;
  const purpose = input.purpose ?? "Moodle browser";
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => {
    timeoutController.abort(
      new StudyBuddyTimeoutError(`${purpose} launch timed out after ${timeoutMs}ms.`),
    );
  }, timeoutMs);
  const signal = input.abortSignal
    ? AbortSignal.any([input.abortSignal, timeoutController.signal])
    : timeoutController.signal;
  const launch = (input.launcher ?? chromium).launch({
    headless: input.headless,
    timeout: timeoutMs,
  });
  let accepted = false;
  void launch.then((browser) => {
    if (!accepted && signal.aborted) void browser.close().catch(() => undefined);
  }, () => undefined);
  try {
    const browser = await raceWithAbort(launch, signal);
    accepted = true;
    return browser;
  } finally {
    clearTimeout(timeout);
  }
}
