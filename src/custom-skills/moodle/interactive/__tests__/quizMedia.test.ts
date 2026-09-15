import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { createPlaywrightBrowserClient } from "../playwrightBrowserClient.js";
import type { MoodleRuntimeConfig } from "../types.js";

const disposals: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const dispose of disposals.reverse()) await dispose(); disposals.length = 0; });

async function fixture(handle: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  disposals.push(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const directory = await mkdtemp(path.join(tmpdir(), "sb-quiz-media-"));
  disposals.push(() => rm(directory, { recursive: true, force: true }));
  const config: MoodleRuntimeConfig = {
    prompt: "test", originalUserPrompt: "test", outputLanguage: "en", outputLanguageReason: "prompt_language",
    moodleUrl: origin, outputPath: path.join(directory, "document.typ"), runDir: directory,
    maxDepth: 0, maxPages: 1, maxCisPages: 0, allowFileDownloads: false,
    baseUrl: origin, dashboardUrl: origin, cisUrls: [], cisBaseUrl: origin, cisDashboardUrl: origin,
    headless: true, browserBackend: "playwright", browserAllowedDomains: ["127.0.0.1"],
  };
  const client = createPlaywrightBrowserClient(config);
  disposals.push(() => client.close());
  return { client, origin, directory, config };
}

function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const payload = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(payload));
    return Buffer.concat([length, payload, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.alloc((width * 3 + 1) * height))), chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("quiz original image evidence (local browser diagnostic)", () => {
  it("downloads authenticated original PNG bytes at source resolution and captures the complete tall question", async () => {
    const original = png(1600, 1000);
    let authenticatedDownloads = 0;
    const { client, origin, directory } = await fixture((request, response) => {
      if (request.url?.startsWith("/protected.png")) {
        if (!request.headers.cookie?.includes("quiz=session-canary")) { response.writeHead(401); response.end(); return; }
        authenticatedDownloads++;
        response.writeHead(200, { "content-type": "image/png", "content-length": original.length });
        response.end(original); return;
      }
      response.writeHead(200, { "content-type": "text/html", "set-cookie": "quiz=session-canary; HttpOnly; SameSite=Lax" });
      response.end('<div id="question-1" style="height:1400px"><p>Which graph?</p><img style="width:160px" src="/protected.png?token=private-canary"><p style="margin-top:1100px">Last option</p></div>');
    });
    await client.open(`${origin}/quiz`);
    const result = await client.captureQuestionEvidence!("question-1", directory);
    expect(result.errors).toEqual([]);
    expect(result.images).toHaveLength(1);
    expect(result.images[0]).toMatchObject({ width: 1600, height: 1000, mimeType: "image/png", sha256: createHash("sha256").update(original).digest("hex") });
    expect(await readFile(result.images[0]!.path)).toEqual(original);
    expect(JSON.stringify(result)).not.toContain("private-canary");
    expect(authenticatedDownloads).toBeGreaterThanOrEqual(2);
    const screenshot = await readFile(result.screenshotPath!);
    expect(screenshot.readUInt32BE(20)).toBeGreaterThanOrEqual(1400);
  });

  it("isolates missing, invalid, redirected and unsafe SVG images while retaining good images and screenshot", async () => {
    const original = png(60, 40);
    let redirectFollowed = false;
    const { client, origin, directory } = await fixture((request, response) => {
      switch (request.url) {
        case "/good": response.writeHead(200, { "content-type": "image/png" }); response.end(original); return;
        case "/wrong-mime": response.writeHead(200, { "content-type": "text/html" }); response.end("<html>login</html>"); return;
        case "/fake-png": response.writeHead(200, { "content-type": "image/png" }); response.end("not a png"); return;
        case "/missing": response.writeHead(404); response.end(); return;
        case "/redirect": response.writeHead(302, { location: "/login?token=secret-canary" }); response.end(); return;
        case "/login?token=secret-canary": redirectFollowed = true; response.end("login"); return;
        case "/unsafe.svg": response.writeHead(200, { "content-type": "image/svg+xml" }); response.end('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="40"><script>alert(1)</script></svg>'); return;
        default: response.writeHead(200, { "content-type": "text/html" }); response.end('<div id="question-2"><img src="/good">Question</div>');
      }
    });
    await client.open(`${origin}/quiz`);
    // Background-image on a display:none node is discoverable without the browser following redirects first.
    await client.evalJson(`JSON.stringify((() => {
      for (const url of ["/wrong-mime", "/fake-png", "/missing", "/redirect", "/unsafe.svg", "https://outside.example/private?token=secret-canary"]) {
        const node = document.createElement("span"); node.style.display = "none";
        node.style.backgroundImage = 'url("' + url + '")'; document.getElementById("question-2").append(node);
      } return true;
    })())`);
    const result = await client.captureQuestionEvidence!("question-2", directory);
    expect(result.images).toHaveLength(1);
    expect(result.errors).toHaveLength(6);
    expect(result.errors.join(" ")).toContain("image-redirect-rejected");
    expect(result.errors.join(" ")).toContain("image-origin-not-allowed");
    expect(JSON.stringify(result)).not.toContain("secret-canary");
    expect(redirectFollowed).toBe(false);
    expect((await stat(result.screenshotPath!)).size).toBeGreaterThan(0);
  });

  it("preserves passive SVG originals and leaves independent quiz sessions isolated", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="1024"><rect width="2048" height="1024" fill="blue"/></svg>');
    const { client, config, origin, directory } = await fixture((request, response) => {
      if (request.url === "/original.svg") { response.writeHead(200, { "content-type": "image/svg+xml" }); response.end(svg); return; }
      response.writeHead(200, { "content-type": "text/html", ...(request.url === "/first" ? { "set-cookie": "quiz=first" } : {}) });
      response.end(`<div id="question-3"><img width="100" src="/original.svg"><p>${request.headers.cookie ?? "no-cookie"}</p></div>`);
    });
    const second = createPlaywrightBrowserClient(config); disposals.push(() => second.close());
    await Promise.all([client.open(`${origin}/first`), second.open(`${origin}/second`)]);
    expect(await second.getText()).toContain("no-cookie");
    await client.open(`${origin}/first-again`);
    expect(await client.getText()).toContain("quiz=first");
    const result = await client.captureQuestionEvidence!("question-3", directory);
    expect(result.errors).toEqual([]);
    expect(result.images[0]).toMatchObject({ width: 2048, height: 1024, mimeType: "image/svg+xml" });
    expect(await readFile(result.images[0]!.path)).toEqual(svg);
  });

  it("retains original images even when writing the question screenshot fails", async () => {
    const original = png(80, 40);
    const { client, origin, directory } = await fixture((request, response) => {
      if (request.url === "/image.png") { response.writeHead(200, { "content-type": "image/png" }); response.end(original); return; }
      response.writeHead(200, { "content-type": "text/html" }); response.end('<div id="question-4"><img src="/image.png"></div>');
    });
    await mkdir(path.join(directory, "question.png"));
    await client.open(`${origin}/quiz`);
    const result = await client.captureQuestionEvidence!("question-4", directory);
    expect(result.screenshotPath).toBeUndefined();
    expect(result.errors).toEqual(["question-screenshot-failed"]);
    expect(result.images).toHaveLength(1);
    expect(await readFile(result.images[0]!.path)).toEqual(original);
  });
});
