import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export type ResourceAttemptStatus =
  | "started"
  | "completed"
  | "failed"
  | "timed_out"
  | "canceled";

export interface ResourceAttemptEvent {
  timestamp: string;
  resourceIndex: number;
  title: string;
  url: string;
  status: ResourceAttemptStatus;
  transport: "authenticated_request" | "agent_browser" | "external_request";
  attempt: number;
  durationMs?: number;
  bytes?: number;
  resolvedUrl?: string | null;
  localPath?: string | null;
  error?: string;
}

export class ResourceAttemptRecorder {
  readonly filePath: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(runDir: string) {
    this.filePath = path.join(runDir, "resource-attempts.jsonl");
  }

  async init(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, "", "utf8");
  }

  record(event: Omit<ResourceAttemptEvent, "timestamp">): Promise<void> {
    const completeEvent: ResourceAttemptEvent = {
      timestamp: new Date().toISOString(),
      ...event,
    };
    const next = this.queue.then(() =>
      appendFile(this.filePath, `${JSON.stringify(completeEvent)}\n`, "utf8")
    );
    this.queue = next.catch(() => undefined);
    return next;
  }
}
