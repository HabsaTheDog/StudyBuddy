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
  it.each([false, true])("waits for a stalled math queue only when the question contains math (%s)", async withMath => {
    const original = png(90, 40);
    const { client, origin, directory } = await fixture((request, response) => {
      if (request.url === "/choice.png") { response.writeHead(200, { "content-type": "image/png" }); response.end(original); return; }
      response.writeHead(200, { "content-type": "text/html" });
      const task = withMath ? String.raw`\(x^2\)` : "Use the original diagram";
      response.end(`<div id="question-1" class="que">${task}<img src="/choice.png"></div>`);
    });
    await client.open(origin);
    await client.evalJson(`JSON.stringify((() => {window.MathJax={Hub:{Queue(){}}};return true;})())`);
    const result = await client.captureQuestionEvidence!("question-1", directory);
    expect(result.complete).toBe(!withMath);
    expect(result.capturedImageCount).toBe(1);
    if (withMath) {
      expect(result.errors).toContain("question-render-readiness-timeout");
      expect(result.readinessDiagnostics).toMatchObject({ incompleteImages: 0, fontsLoading: false, questionMath: true });
    } else expect(result.errors).toEqual([]);
  }, 30000);

  it.each([String.raw`\(x + 1\)`, String.raw`\[x + 1\]`])("retains the readiness gate for raw TeX delimiters %s with a stalled global queue", async rawMath => {
    const {client,origin,directory}=await fixture((_request,response)=> {
      response.writeHead(200,{"content-type":"text/html"});
      response.end('<div id="question-1">Only a raw text formula</div>');
    });
    await client.open(origin);
    await client.evalJson(`JSON.stringify((() => {
      document.getElementById('question-1').textContent=${JSON.stringify(rawMath)};
      window.MathJax={Hub:{Queue(){}}};return true;
    })())`);
    const result=await client.captureQuestionEvidence!("question-1",directory);
    expect(result.complete).toBe(false);
    expect(result.errors).toContain("question-render-readiness-timeout");
    expect(result.readinessDiagnostics).toMatchObject({questionMath:true,mathJaxHub:true});
  });

  it("ignores src-less native drop placeholders while retaining every actual source image", async () => {
    const original = png(90, 40);
    const { client, origin, directory } = await fixture((request, response) => {
      if (request.url === "/choice.png") {
        response.writeHead(200, { "content-type": "image/png" });
        response.end(original);
        return;
      }
      response.writeHead(200, { "content-type": "text/html" });
      response.end(
        '<div id="question-1" class="que ddimageortext"><div class="dropzone"><img class="drop-placeholder"></div><img src="/choice.png"></div>',
      );
    });
    await client.open(origin);
    // A src-less image can remain incomplete forever and has no load/error event.
    await client.evalJson(
      `JSON.stringify((() => {Object.defineProperty(document.querySelector('.drop-placeholder'),'complete',{value:false});return true;})())`,
    );
    const result = await client.captureQuestionEvidence!("question-1", directory);
    expect(result).toMatchObject({
      complete: true,
      expectedImageCount: 1,
      capturedImageCount: 1,
      errors: [],
    });
    expect(await readFile(result.images[0]!.path)).toEqual(original);
  });


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
    const originalDom = await client.evalJson('JSON.stringify(Array.from(document.querySelectorAll("#question-1 img"), i => i.getAttribute("loading")))');
    const result = await client.captureQuestionEvidence!("question-1", directory);
    expect(await client.evalJson('JSON.stringify(Array.from(document.querySelectorAll("#question-1 img"), i => i.getAttribute("loading")))')).toEqual(originalDom);
    expect(result.errors).toEqual([]);
    expect(result).toMatchObject({ complete: true, expectedImageCount: 1, capturedImageCount: 1 });
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
    expect(result).toMatchObject({ complete: false, expectedImageCount: 7, capturedImageCount: 1 });
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
    const view = await readFile(result.images[0]!.viewPath!);
    expect(view.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(view.readUInt32BE(16)).toBe(2048);
    expect(view.readUInt32BE(20)).toBe(1024);
  });

  it("prioritizes the largest source variant before the rendered thumbnail", async () => {
    const small = png(80, 50), large = png(1600, 1000);
    const { client, origin, directory } = await fixture((request, response) => {
      if (request.url === "/small.png" || request.url === "/large.png") {
        response.writeHead(200, { "content-type": "image/png" });
        response.end(request.url === "/small.png" ? small : large); return;
      }
      response.writeHead(200, { "content-type": "text/html" });
      response.end('<div id="question-5"><img width="80" src="/small.png" srcset="/small.png 80w, /large.png 1600w" sizes="80px"></div>');
    });
    await client.open(`${origin}/quiz`);
    const result = await client.captureQuestionEvidence!("question-5", directory);
    expect(result.images).toHaveLength(2);
    expect(result.images[0]).toMatchObject({ width: 1600, height: 1000, sourceIndex: 1 });
    expect(await readFile(result.images[0]!.path)).toEqual(large);
    expect(result.complete).toBe(true);
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

  it("includes original shared description graphics in the solver evidence", async () => {
    const original = png(1600, 1000);
    const { client, origin, directory } = await fixture((request, response) => {
      if (request.url === "/shared.png") {
        response.writeHead(200, { "content-type": "image/png" }); response.end(original); return;
      }
      response.writeHead(200, { "content-type": "text/html" });
      response.end('<div id="question-1" class="que description"><img width="100" src="/shared.png"></div><div id="question-2" class="que">Read the shared graph.</div>');
    });
    await client.open(`${origin}/quiz`);
    const result = await client.captureQuestionEvidence!("question-2", directory);
    expect(result.complete).toBe(true);
    expect(result.images).toHaveLength(1);
    expect(result.images[0]).toMatchObject({ width: 1600, height: 1000 });
    expect(await readFile(result.images[0]!.path)).toEqual(original);
  });
});
