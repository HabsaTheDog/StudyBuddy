/** Official Mobile authentication and read-only identity lookup. No attempt actions.
 * Authentication can create a token on Moodle; we retain tokens only in memory.
 * See Moodle login/token.php, mod/quiz/db/services.php and classes/external.php.
 */
export interface QuizAttemptReadApiInput {
  targetUrl: string;
  courseId: number;
  username: string;
  password: string;
}
export interface QuizAttemptReadApiEvidence {
  source: "moodle-mobile-read-api";
  courseId: number;
  courseModuleId: number;
  quizId: number;
  userId: number;
  attemptId: string;
  attemptNumber: 1;
  state: "inprogress";
  preview: false;
}
export type QuizAttemptReadApiFailure =
  | "read-api-target-invalid"
  | "mobile-authentication-unavailable"
  | "mobile-service-disabled"
  | "read-api-method-unavailable"
  | "read-api-quiz-unconfirmed"
  | "first-attempt-identity-unconfirmed"
  | "read-api-service-unavailable"
  | "read-api-invalid-response"
  | "read-api-http-error"
  | "read-api-response-too-large"
  | "read-api-timeout"
  | "read-api-transport-error";
export type QuizAttemptReadApiResult =
  | { ok: true; identityEvidence: QuizAttemptReadApiEvidence }
  | { ok: false; error: QuizAttemptReadApiFailure };

const READ_METHODS = new Set([
  "core_webservice_get_site_info",
  "mod_quiz_get_quizzes_by_courses",
  "mod_quiz_get_user_quiz_attempts",
  "mod_quiz_get_user_attempts",
]);
const MAX_BODY_BYTES = 1024 * 1024;
class Failure extends Error {
  constructor(readonly code: QuizAttemptReadApiFailure) {
    super(code);
  }
}
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

export async function readFirstQuizAttemptIdentity(
  input: QuizAttemptReadApiInput,
  dependencies: { fetch?: typeof globalThis.fetch; timeoutMs?: number } = {},
): Promise<QuizAttemptReadApiResult> {
  try {
    let target: URL;
    try {
      target = new URL(input.targetUrl);
    } catch {
      throw new Failure("read-api-target-invalid");
    }
    const cmid = Number(target.searchParams.get("id"));
    const query = [...target.searchParams.entries()];
    if (
      target.protocol !== "https:" ||
      target.username ||
      target.password ||
      target.hash ||
      !/\/mod\/quiz\/view\.php$/.test(target.pathname) ||
      query.length !== 1 ||
      query[0]?.[0] !== "id" ||
      !/^[1-9]\d*$/.test(query[0]?.[1] ?? "") ||
      !positive(cmid) ||
      !positive(input.courseId)
    )
      throw new Failure("read-api-target-invalid");
    if (
      typeof input.username !== "string" ||
      !input.username.trim() ||
      typeof input.password !== "string" ||
      !input.password
    )
      throw new Failure("mobile-authentication-unavailable");
    const prefix = target.pathname.slice(0, -"/mod/quiz/view.php".length);
    const fetcher = dependencies.fetch ?? globalThis.fetch;
    const timeoutMs = Math.min(30_000, Math.max(100, dependencies.timeoutMs ?? 15_000));

    const post = async (
      pathname: string,
      params: URLSearchParams,
    ): Promise<Record<string, unknown>> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response | undefined;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        response = await fetcher(new URL(prefix + pathname, target.origin), {
          method: "POST",
          redirect: "error",
          signal: controller.signal,
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            accept: "application/json",
          },
          body: params,
        });
        if (!response.ok) throw new Failure("read-api-http-error");
        if (Number(response.headers.get("content-length")) > MAX_BODY_BYTES)
          throw new Failure("read-api-response-too-large");
        if (!response.body) throw new Failure("read-api-invalid-response");
        reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > MAX_BODY_BYTES) throw new Failure("read-api-response-too-large");
          chunks.push(part.value);
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          throw new Failure("read-api-invalid-response");
        }
        const value = object(parsed);
        if (!value) throw new Failure("read-api-invalid-response");
        return value;
      } catch (error) {
        if (error instanceof Failure) throw error;
        throw new Failure(
          controller.signal.aborted ? "read-api-timeout" : "read-api-transport-error",
        );
      } finally {
        clearTimeout(timer);
        await reader?.cancel().catch(() => undefined);
        if (!reader) await response?.body?.cancel().catch(() => undefined);
      }
    };

    const authentication = await post(
      "/login/token.php",
      new URLSearchParams({
        username: input.username,
        password: input.password,
        service: "moodle_mobile_app",
      }),
    );
    if (["enablewsdescription", "servicenotavailable"].includes(String(authentication.errorcode)))
      throw new Failure("mobile-service-disabled");
    if (
      authentication.error ||
      authentication.exception ||
      authentication.errorcode ||
      typeof authentication.token !== "string" ||
      !authentication.token ||
      authentication.token.length > 4096
    )
      throw new Failure("mobile-authentication-unavailable");
    // Token/private token/raw authentication response never leaves this function.
    const token = authentication.token;
    const read = async (method: string, args: Record<string, string> = {}) => {
      if (!READ_METHODS.has(method)) throw new Failure("read-api-method-unavailable");
      const value = await post(
        "/webservice/rest/server.php",
        new URLSearchParams({
          ...args,
          wstoken: token,
          wsfunction: method,
          moodlewsrestformat: "json",
        }),
      );
      if (value.error || value.exception || value.errorcode)
        throw new Failure("read-api-service-unavailable");
      return value;
    };
    const info = await read("core_webservice_get_site_info");
    if (!positive(info.userid)) throw new Failure("first-attempt-identity-unconfirmed");
    const available = new Set(
      Array.isArray(info.functions) ? info.functions.map((value) => object(value)?.name) : [],
    );
    const method = available.has("mod_quiz_get_user_quiz_attempts")
      ? "mod_quiz_get_user_quiz_attempts"
      : available.has("mod_quiz_get_user_attempts")
        ? "mod_quiz_get_user_attempts"
        : null;
    if (!available.has("mod_quiz_get_quizzes_by_courses") || !method)
      throw new Failure("read-api-method-unavailable");
    const quizzes = await read("mod_quiz_get_quizzes_by_courses", {
      "courseids[0]": String(input.courseId),
    });
    const matches = Array.isArray(quizzes.quizzes)
      ? quizzes.quizzes.map(object).filter((value) => value?.coursemodule === cmid)
      : [];
    const quiz = matches[0];
    if (matches.length !== 1 || !quiz || !positive(quiz.id) || quiz.course !== input.courseId)
      throw new Failure("read-api-quiz-unconfirmed");
    const result = await read(method, {
      quizid: String(quiz.id),
      userid: "0",
      status: "unfinished",
      includepreviews: "0",
    });
    const attempts = Array.isArray(result.attempts) ? result.attempts : [];
    const attempt = object(attempts[0]);
    if (
      attempts.length !== 1 ||
      !attempt ||
      !positive(attempt.id) ||
      attempt.quiz !== quiz.id ||
      attempt.userid !== info.userid ||
      attempt.attempt !== 1 ||
      attempt.state !== "inprogress" ||
      (attempt.preview !== 0 && attempt.preview !== false)
    )
      throw new Failure("first-attempt-identity-unconfirmed");
    return {
      ok: true,
      identityEvidence: {
        source: "moodle-mobile-read-api",
        courseId: input.courseId,
        courseModuleId: cmid,
        quizId: quiz.id,
        userId: info.userid,
        attemptId: String(attempt.id),
        attemptNumber: 1,
        state: "inprogress",
        preview: false,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Failure ? error.code : "read-api-invalid-response",
    };
  }
}
