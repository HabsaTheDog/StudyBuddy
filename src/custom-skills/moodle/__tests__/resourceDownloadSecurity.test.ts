import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { BrowserContext } from "playwright";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadResourceWithRequest } from "../nodes/scraperNode.js";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("authenticated resource download security", () => {
  it("streams an authenticated response into an atomic local artifact", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "resource-download-"));
    tempDirs.push(runDir);
    const target = path.join(runDir, "resource.txt");
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.redirect).toBe("manual");
      expect(init?.headers).toEqual({ cookie: "MoodleSession=session-value" });
      return new Response("bounded resource text", {
        headers: { "content-type": "text/plain", "content-length": "21" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const context = {
      cookies: vi.fn(async () => [{ name: "MoodleSession", value: "session-value" }]),
    } as unknown as BrowserContext;

    const result = await downloadResourceWithRequest(context, "https://1.1.1.1/resource.txt", target);

    expect(await readFile(result.localPath, "utf8")).toBe("bounded resource text");
    expect(result.bytes).toBe(21);
    expect((await stat(result.localPath)).size).toBe(21);
  });

  it("rejects private destinations and oversized declared bodies before writing", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "resource-download-"));
    tempDirs.push(runDir);
    const context = { cookies: vi.fn(async () => []) } as unknown as BrowserContext;
    const fetchMock = vi.fn(async () => new Response("x", {
      headers: { "content-type": "text/plain", "content-length": String(101 * 1024 * 1024) },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(downloadResourceWithRequest(
      context,
      "https://127.0.0.1/resource.txt",
      path.join(runDir, "private.txt"),
    )).rejects.toThrow("local or private");
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(downloadResourceWithRequest(
      context,
      "https://1.1.1.1/resource.txt",
      path.join(runDir, "large.txt"),
    )).rejects.toThrow("100 MiB");
    await expect(stat(path.join(runDir, "large.txt"))).rejects.toThrow();
  });
});
