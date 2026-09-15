// @effect-diagnostics nodeBuiltinImport:off
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import { sanitizeModelVisibleUrl } from "./browserSecurity.js";

export interface QuizImageEvidence {
  path: string;
  url: string;
  mimeType: string;
  sha256: string;
  width?: number;
  height?: number;
}

export interface QuizQuestionEvidence {
  screenshotPath?: string;
  images: QuizImageEvidence[];
  errors: string[];
}

const IMAGE_BYTES = 16 * 1024 * 1024;
const REQUEST_TIMEOUT = 10_000;

/** Acquire source bytes using this quiz's authenticated context, never a resized canvas. */
export async function captureQuizQuestionEvidence(
  page: Page,
  questionId: string,
  directory: string,
  sensitiveValues: ReadonlyArray<string | undefined> = [],
): Promise<QuizQuestionEvidence> {
  if (!/^question-[a-zA-Z0-9_-]+$/.test(questionId)) throw new Error("Invalid question image target");
  const evidence: QuizQuestionEvidence = { images: [], errors: [] };
  await mkdir(directory, { recursive: true });
  const question = page.locator(`[id="${questionId}"]`);
  try {
    await question.scrollIntoViewIfNeeded({ timeout: 5_000 });
    const ready = await question.evaluate(async (element) => {
      const images = Array.from(element.querySelectorAll("img"));
      // Trigger lazy images without changing their source or displayed size.
      for (const image of images) image.loading = "eager";
      const math = (window as unknown as {
        MathJax?: { startup?: { promise?: Promise<unknown> }; Hub?: { Queue: (cb: () => void) => void } };
      }).MathJax;
      const pending: Promise<unknown>[] = [document.fonts.ready];
      for (const image of images) {
        if (!image.complete) pending.push(new Promise<void>((resolve) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        }));
      }
      if (math?.startup?.promise) pending.push(math.startup.promise);
      else if (math?.Hub) pending.push(new Promise<void>((resolve) => math.Hub!.Queue(resolve)));
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          Promise.allSettled(pending).then(() => true),
          new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), 4_000); }),
        ]);
      } finally { if (timer) clearTimeout(timer); }
    }, undefined, { timeout: 5_000 });
    if (!ready) evidence.errors.push("question-render-readiness-timeout");
  } catch { evidence.errors.push("question-render-readiness-failed"); }

  // Download and screenshot independently: a failed image must not discard the question context.
  const mediaTask = (async () => {
    let sources: string[];
    try {
      sources = await question.evaluate((element) => {
        const urls = new Set<string>();
        for (const image of Array.from(element.querySelectorAll("img"))) {
          if (image.src) urls.add(image.src);
          if (image.currentSrc) urls.add(image.currentSrc);
          // Preserve the highest resolution variant when the browser chose a smaller srcset.
          const candidates = (image.srcset || image.closest("picture")?.querySelector("source")?.srcset || "")
            .split(",").map((item) => item.trim().split(/\s+/))
            .filter((item) => item[0] && /^\d+(?:\.\d+)?[wx]$/.test(item[1] ?? ""))
            .sort((a, b) => parseFloat(b[1]!) - parseFloat(a[1]!));
          if (candidates[0]?.[0]) urls.add(new URL(candidates[0][0], document.baseURI).href);
        }
        for (const image of Array.from(element.querySelectorAll("svg image"))) {
          const source = image.getAttribute("href") || image.getAttribute("xlink:href");
          if (source) urls.add(new URL(source, document.baseURI).href);
        }
        for (const node of [element, ...Array.from(element.querySelectorAll("*"))]) {
          for (const match of getComputedStyle(node).backgroundImage.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
            if (match[1]) urls.add(new URL(match[1], document.baseURI).href);
          }
        }
        return [...urls];
      }, undefined, { timeout: 5_000 });
    } catch { evidence.errors.push("question-image-discovery-failed"); return; }
    const outcomes = new Array<QuizImageEvidence | undefined>(sources.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, sources.length) }, async () => {
      while (next < sources.length) {
        const index = next++;
        try {
          outcomes[index] = await downloadQuestionImage(page, sources[index]!, directory, index, sensitiveValues);
        } catch (error) {
          // Only controlled error codes leave this boundary; request errors can contain credentials.
          const code = error instanceof QuizMediaError ? error.message : "image-download-failed";
          evidence.errors.push(`image-${index + 1}:${code}`);
        }
      }
    }));
    evidence.images = outcomes.filter((image): image is QuizImageEvidence => Boolean(image));
  })();
  try {
    const screenshotPath = path.resolve(directory, "question.png");
    await question.screenshot({ path: screenshotPath, animations: "disabled", timeout: 8_000 });
    evidence.screenshotPath = screenshotPath;
  } catch { evidence.errors.push("question-screenshot-failed"); }
  await mediaTask;
  return evidence;
}

class QuizMediaError extends Error {}

async function downloadQuestionImage(
  page: Page, source: string, directory: string, index: number,
  sensitiveValues: ReadonlyArray<string | undefined>,
): Promise<QuizImageEvidence> {
  const url = new URL(source);
  if (url.origin !== new URL(page.url()).origin || !/^https?:$/.test(url.protocol) || url.username || url.password)
    throw new QuizMediaError("image-origin-not-allowed");
  // No redirects: in particular an expired session must not fetch a login/SSO page.
  const response = await page.context().request.get(url.href, {
    maxRedirects: 0, timeout: REQUEST_TIMEOUT, failOnStatusCode: false,
  });
  try {
    if (response.status() >= 300 && response.status() < 400) throw new QuizMediaError("image-redirect-rejected");
    if (!response.ok()) throw new QuizMediaError(`image-http-${response.status()}`);
    if (Number(response.headers()["content-length"] ?? 0) > IMAGE_BYTES) throw new QuizMediaError("image-too-large");
    const bytes = await response.body();
    if (!bytes.length || bytes.length > IMAGE_BYTES) throw new QuizMediaError("image-size-invalid");
    const mimeType = (response.headers()["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    const extension = imageExtension(bytes, mimeType);
    const dimensions = await page.evaluate(async ({ data, mime }) => {
      const binary = atob(data);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      if (mime === "image/svg+xml") {
        const document = new DOMParser().parseFromString(new TextDecoder().decode(bytes), "image/svg+xml");
        if (document.querySelector("parsererror") || document.documentElement.localName !== "svg") return null;
        for (const element of Array.from(document.querySelectorAll("*"))) {
          if (["script", "foreignobject", "iframe", "object", "embed", "style", "animate", "set", "animatemotion", "animatetransform"].includes(element.localName.toLowerCase())) return null;
          for (const attribute of Array.from(element.attributes)) {
            const name = attribute.localName.toLowerCase();
            if (name.startsWith("on") || name === "base" || /[\\@]/.test(attribute.value)) return null;
            if (name === "href" && !attribute.value.startsWith("#")) return null;
            if (/url\s*\(/i.test(attribute.value) && !/^url\(\s*["']?#[\w.-]+["']?\s*\)$/.test(attribute.value)) return null;
          }
        }
      }
      const objectUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
      try {
        const image = new Image();
        image.src = objectUrl;
        await image.decode();
        return { width: image.naturalWidth, height: image.naturalHeight };
      } catch { return null; }
      finally { URL.revokeObjectURL(objectUrl); }
    }, { data: bytes.toString("base64"), mime: mimeType });
    if (!dimensions || !dimensions.width || !dimensions.height) throw new QuizMediaError("image-decode-or-safety-failed");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const imagePath = path.resolve(directory, `image-${index + 1}-${sha256.slice(0, 12)}.${extension}`);
    await writeFile(imagePath, bytes);
    return { path: imagePath, url: sanitizeModelVisibleUrl(source, sensitiveValues), mimeType, sha256, ...dimensions };
  } finally { await response.dispose(); }
}

function imageExtension(bytes: Buffer, mime: string): string {
  const hex = bytes.subarray(0, 12).toString("hex");
  if (mime === "image/png" && hex.startsWith("89504e470d0a1a0a")) return "png";
  if (mime === "image/jpeg" && hex.startsWith("ffd8ff")) return "jpg";
  if (mime === "image/gif" && /^GIF8[79]a/.test(bytes.subarray(0, 6).toString())) return "gif";
  if (mime === "image/webp" && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (mime === "image/bmp" && hex.startsWith("424d")) return "bmp";
  if (mime === "image/avif" && bytes.toString("ascii", 4, 8) === "ftyp" && /avif|avis/.test(bytes.toString("ascii", 8, 32))) return "avif";
  if (mime === "image/svg+xml") {
    const svg = bytes.toString("utf8");
    if (!/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(svg) && /<svg[\s>]/i.test(svg)) return "svg";
  }
  throw new QuizMediaError("image-mime-or-signature-invalid");
}
