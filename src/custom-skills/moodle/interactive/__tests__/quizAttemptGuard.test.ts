import { mkdtemp, rm, symlink, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertSameQuizAttempt,
  bindFirstQuizAttempt,
  loadFirstQuizAttemptBinding,
  reserveFirstQuizAttempt,
  reconcileFirstQuizAttempt,
  consumeFirstQuizStartRequest,
  openFirstQuizAttempt,
  recordFirstQuizStartRedirect,
  loadFirstQuizStartRedirect,
  proveFirstQuizAttemptIdentity,
} from "../quizAttemptGuard.js";
import type { AgentBrowserClient } from "../agentBrowserClient.js";
import type { MoodleRuntimeConfig } from "../types.js";
import { extractQuizMetadata, normalizeQuizMetadata } from "../quizSafetyPolicy.js";
import { createPlaywrightBrowserClient } from "../playwrightBrowserClient.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function config(accountKey = "account-one") {
  const ledgerRoot = await mkdtemp(path.join(os.tmpdir(), "first-quiz-"));
  roots.push(ledgerRoot);
  return { ledgerRoot, accountKey, targetUrl: "https://moodle.example/mod/quiz/view.php?id=7" };
}
const fresh = () =>
  normalizeQuizMetadata({ attemptsUsed: 0, attemptsAllowed: 2, hasStartControl: true });
describe("durable first quiz attempt", () => {
  it("shares one durable start debit across configured and canonical directory aliases", async () => {
    const c = await config();
    const canonical = { ...c, ledgerRoot: await realpath(c.ledgerRoot) };
    await reserveFirstQuizAttempt(c, fresh());
    await expect(reserveFirstQuizAttempt(canonical, fresh())).rejects.toThrow(/already reserved/);
    await consumeFirstQuizStartRequest(canonical);
    await expect(consumeFirstQuizStartRequest(c)).rejects.toThrow(/already consumed/);
  });
  it("recovers an ID-less native first-attempt card only from its own durable verified start response", async () => {
    const c = await config();
    const card: ReturnType<typeof normalizeQuizMetadata> = {
      ...fresh(),
      attemptsUsed: 1,
      hasActiveAttempt: true,
      activeAttemptId: null,
      activeAttemptNumber: null,
      identityEvidence: {
        currentAttemptId: null,
        continuation: [],
        history: [{ ordinal: 1, attemptId: null, source: "history-card" }],
      },
    };
    await reserveFirstQuizAttempt(c, fresh());
    await consumeFirstQuizStartRequest(c);
    await expect(proveFirstQuizAttemptIdentity(c, card)).rejects.toThrow();
    await recordFirstQuizStartRedirect(c, {
      status: 303,
      startUrl: "https://moodle.example/mod/quiz/startattempt.php",
      attemptUrl: "https://moodle.example/mod/quiz/attempt.php?attempt=321&cmid=7",
    });
    expect(await loadFirstQuizStartRedirect({ ...c })).toMatchObject({
      attemptId: "321",
      status: 303,
    });
    expect(await reconcileFirstQuizAttempt({ ...c }, card)).toMatchObject({
      attemptId: "321",
      attemptNumber: 1,
    });
    await expect(consumeFirstQuizStartRequest(c)).rejects.toThrow(/already consumed/);
    const changes: Array<ReturnType<typeof normalizeQuizMetadata>> = [
      { ...card, attemptsUsed: 2 },
      { ...card, hasActiveAttempt: false },
      { ...card, activeAttemptId: "322" },
      { ...card, activeAttemptNumber: 2 },
      {
        ...card,
        identityEvidence: {
          ...card.identityEvidence!,
          history: [{ ordinal: 2, attemptId: null, source: "history-card" }],
        },
      },
      { ...card, identityEvidence: { ...card.identityEvidence!, history: [] } },
    ];
    for (const changed of changes)
      await expect(proveFirstQuizAttemptIdentity(c, changed)).rejects.toThrow();
  });
  it("does not synthesize a response receipt from a legacy debit or conflicting/foreign redirect", async () => {
    const c = await config();
    await reserveFirstQuizAttempt(c, fresh());
    const valid = {
      status: 303 as const,
      startUrl: "https://moodle.example/mod/quiz/startattempt.php",
      attemptUrl: "https://moodle.example/mod/quiz/attempt.php?attempt=321",
    };
    await expect(recordFirstQuizStartRedirect(c, valid)).rejects.toThrow();
    await consumeFirstQuizStartRequest(c);
    await expect(
      recordFirstQuizStartRedirect(c, {
        ...valid,
        attemptUrl: "https://foreign.example/mod/quiz/attempt.php?attempt=321",
      }),
    ).rejects.toThrow();
    await recordFirstQuizStartRedirect(c, valid);
    await recordFirstQuizStartRedirect(c, valid);
    await expect(
      recordFirstQuizStartRedirect(c, {
        ...valid,
        attemptUrl: valid.attemptUrl.replace("321", "322"),
      }),
    ).rejects.toThrow();
    const legacy = await config();
    await reserveFirstQuizAttempt(legacy, fresh());
    await consumeFirstQuizStartRequest(legacy);
    const [folder] = await readdir(legacy.ledgerRoot);
    const reservationPath = path.join(legacy.ledgerRoot, folder!, "reservation.json");
    const reservation = JSON.parse(await readFile(reservationPath, "utf8"));
    delete reservation.preflight;
    await writeFile(reservationPath, JSON.stringify(reservation));
    await expect(recordFirstQuizStartRedirect(legacy, valid)).rejects.toThrow(/fresh reservation/);
    expect(await loadFirstQuizStartRedirect(legacy)).toBeNull();
  });
  it("reads actual native zero/history/active ordinal facts without double-counting review links", async () => {
    let html = "Erlaubte Versuche: 2 <button>Test versuchen</button>";
    const server = createServer((_request, response) => {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(html);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const client = createPlaywrightBrowserClient({
      baseUrl,
      headless: true,
    } as MoodleRuntimeConfig);
    try {
      await client.open(`${baseUrl}/mod/quiz/view.php?id=7`);
      expect(await extractQuizMetadata(client)).toMatchObject({
        attemptsUsed: 0,
        hasActiveAttempt: false,
      });
      html = "Erlaubte Versuche: 2 <button>Test wiederholen</button>";
      await client.open(`${baseUrl}/mod/quiz/view.php?id=7`);
      expect(await extractQuizMetadata(client)).toMatchObject({
        attemptsUsed: null,
        hasActiveAttempt: false,
      });
      html =
        'Erlaubte Versuche: 2 Ihre Versuche <table><tbody><tr><td>1</td><td>Versuch 1 <a href="/mod/quiz/review.php?attempt=321">Review</a> <a href="/mod/quiz/attempt.php?attempt=321">Versuch fortsetzen</a></td></tr></tbody></table>';
      await client.open(`${baseUrl}/mod/quiz/view.php?id=7`);
      expect(await extractQuizMetadata(client)).toMatchObject({
        attemptsUsed: 1,
        hasActiveAttempt: true,
        activeAttemptId: "321",
        activeAttemptNumber: 1,
      });
      html =
        'Erlaubte Versuche: 2 Ihre Versuche <table><tbody><tr><td>2</td><td><a href="/mod/quiz/attempt.php?attempt=322">Versuch fortsetzen</a></td></tr></tbody></table>';
      await client.open(`${baseUrl}/mod/quiz/view.php?id=7`);
      expect(await extractQuizMetadata(client)).toMatchObject({
        attemptsUsed: 2,
        activeAttemptNumber: 2,
        activeAttemptId: "322",
      });
      html =
        '<div class="que" id="question-99"><div class="qtext">Attempt 1: compute the result.</div></div>';
      await client.open(`${baseUrl}/mod/quiz/attempt.php?attempt=99`);
      expect(await extractQuizMetadata(client)).toMatchObject({
        activeAttemptId: "99",
        activeAttemptNumber: null,
      });
    } finally {
      await client.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("debits the actual start POST once, including concurrency and process-style restart", async () => {
    const c = await config();
    await expect(consumeFirstQuizStartRequest(c)).rejects.toThrow(/reservation/);
    await reserveFirstQuizAttempt(c, fresh());
    const debits = await Promise.allSettled(
      Array.from({ length: 5 }, () => consumeFirstQuizStartRequest(c)),
    );
    expect(debits.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await expect(consumeFirstQuizStartRequest({ ...c })).rejects.toThrow(/already consumed/);
  });
  it("allows only one concurrent start reservation and never releases it after a lost response", async () => {
    const c = await config();
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => reserveFirstQuizAttempt(c, fresh())),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(7);
    await expect(reserveFirstQuizAttempt({ ...c }, fresh())).rejects.toThrow(/already reserved/);
  });
  it.each([null, 1, 2])(
    "rejects unknown or already-used history (%s) before reservation",
    async (attemptsUsed) => {
      const c = await config();
      await expect(
        reserveFirstQuizAttempt(c, normalizeQuizMetadata({ attemptsUsed, hasStartControl: true })),
      ).rejects.toThrow(/first-attempt/);
      await expect(reserveFirstQuizAttempt(c, fresh())).resolves.toBeUndefined();
    },
  );
  it("rejects new starts for an active attempt", async () => {
    await expect(
      reserveFirstQuizAttempt(await config(), { ...fresh(), hasActiveAttempt: true }),
    ).rejects.toThrow(/first-attempt/);
  });
  it("binds one actual first ID and preserves it across process-style reloads", async () => {
    const c = await config();
    await reserveFirstQuizAttempt(c, fresh());
    await expect(bindFirstQuizAttempt(c, { attemptId: "321", attemptNumber: 1 })).rejects.toThrow(
      /consumed/,
    );
    await consumeFirstQuizStartRequest(c);
    const binding = await bindFirstQuizAttempt(c, { attemptId: "321", attemptNumber: 1 });
    expect(await loadFirstQuizAttemptBinding({ ...c })).toEqual(binding);
    await expect(bindFirstQuizAttempt(c, { attemptId: "321", attemptNumber: 1 })).resolves.toEqual(
      binding,
    );
    await expect(bindFirstQuizAttempt(c, { attemptId: "322", attemptNumber: 1 })).rejects.toThrow(
      /different/,
    );
    expect(() =>
      assertSameQuizAttempt(
        binding,
        "https://moodle.example/mod/quiz/attempt.php?attempt=321&page=2",
      ),
    ).not.toThrow();
    for (const url of [
      "https://moodle.example/mod/quiz/attempt.php?attempt=322",
      "https://other.example/mod/quiz/attempt.php?attempt=321",
      "https://moodle.example/mod/quiz/startattempt.php?attempt=321",
    ]) {
      expect(() => assertSameQuizAttempt(binding, url)).toThrow(/same/);
    }
  });
  it("cannot bind a second ordinal or an ID without a start reservation", async () => {
    const c = await config();
    await expect(bindFirstQuizAttempt(c, { attemptId: "321", attemptNumber: 1 })).rejects.toThrow(
      /reservation/,
    );
    await reserveFirstQuizAttempt(c, fresh());
    await expect(bindFirstQuizAttempt(c, { attemptId: "322", attemptNumber: 2 })).rejects.toThrow(
      /first/,
    );
  });
  it("recovers only positive active first-ID evidence after an uncertain start", async () => {
    const c = await config();
    await reserveFirstQuizAttempt(c, fresh());
    await expect(
      reconcileFirstQuizAttempt(c, { ...fresh(), hasActiveAttempt: true, attemptsUsed: 1 }),
    ).rejects.toThrow(/first/);
    const recovered = await reconcileFirstQuizAttempt(c, {
      ...fresh(),
      hasActiveAttempt: true,
      attemptsUsed: 1,
      activeAttemptId: "321",
      activeAttemptNumber: 1,
    });
    expect(recovered.attemptId).toBe("321");
    await expect(
      reconcileFirstQuizAttempt(c, {
        ...fresh(),
        hasActiveAttempt: true,
        attemptsUsed: 2,
        activeAttemptId: "322",
        activeAttemptNumber: 2,
      }),
    ).rejects.toThrow(/first/);
  });
  it("keeps distinct accounts and quizzes separate, never distinct grants for the same quiz", async () => {
    const c = await config();
    await reserveFirstQuizAttempt(c, fresh());
    await expect(
      reserveFirstQuizAttempt({ ...c, accountKey: "account-two" }, fresh()),
    ).resolves.toBeUndefined();
    await expect(
      reserveFirstQuizAttempt(
        { ...c, targetUrl: "https://moodle.example/mod/quiz/view.php?id=8" },
        fresh(),
      ),
    ).resolves.toBeUndefined();
    await expect(
      reserveFirstQuizAttempt({ ...c, targetUrl: c.targetUrl + "&page=3#x" }, fresh()),
    ).rejects.toThrow(/already reserved/);
  });
  it("fails closed before a legacy browser click without the request guard capability", async () => {
    let clicks = 0;
    await expect(
      openFirstQuizAttempt({
        config: { quizSafetyPolicy: { firstAttemptOnly: true } } as MoodleRuntimeConfig,
        client: {} as AgentBrowserClient,
        targetUrl: (await config()).targetUrl,
        metadata: fresh(),
        open: async () => {
          clicks++;
        },
      }),
    ).rejects.toThrow(/guarded browser/);
    expect(clicks).toBe(0);
  });
  it("rejects a symlinked trusted ledger root", async () => {
    const c = await config();
    const parent = await config();
    const link = path.join(parent.ledgerRoot, "link");
    await symlink(c.ledgerRoot, link, process.platform === "win32" ? "junction" : "dir");
    await expect(reserveFirstQuizAttempt({ ...c, ledgerRoot: link }, fresh())).rejects.toThrow(
      /symlink/,
    );
  });
});
