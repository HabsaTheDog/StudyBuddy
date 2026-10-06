/** Request admission is independent of button labels and model-visible DOM text. */
export interface QuizHttpRequest {
  url: string;
  method: string;
  postData: string | null;
  /** Trusted browser navigation provenance, never caller-provided tool input. */
  redirectedFrom?: { url: string; method: string; status?: number };
}
export type QuizRequestGuard = (request: QuizHttpRequest) => void | Promise<void>;

export class QuizRequestBlockedError extends Error {
  constructor(request?: QuizHttpRequest) {
    const diagnostic = request ? safeQuizRequestDiagnostic(request) : "";
    super(`Quiz request blocked by attempt safety guard.${diagnostic ? ` (${diagnostic})` : ""}`);
    this.name = "QuizRequestBlockedError";
  }
}

/** Fixed categories only: never expose URL/query/body, account data or sesskeys. */
export function safeQuizRequestDiagnostic(request: QuizHttpRequest): string {
  const method = /^(GET|HEAD|POST)$/i.test(request.method) ? request.method.toUpperCase() : "OTHER";
  let endpoint = "other";
  try {
    const pathname = new URL(request.url).pathname;
    const known =
      /\/(view|attempt|summary|review|startattempt|processattempt|autosave\.ajax|service|image|pluginfile|javascript|yui_combo)\.php(?:\/|$)/i.exec(
        pathname,
      );
    if (known) endpoint = known[1]!.toLowerCase();
  } catch {
    /* Malformed URLs remain opaque. */
  }
  return `${method} ${endpoint}`;
}

type Fields = Array<[string, string]>;
const fieldName = (name: string) =>
  name
    .split(/[\[\0]/, 1)[0]!
    .toLowerCase()
    .replace(/[_-]/g, "");
const finalFlag = (name: string) =>
  /^(?:finishattempt|timeup|finalsubmit|submitallandfinish|confirm submission|confirmsubmission)$/.test(
    fieldName(name),
  );
const readMethod = (method: string) => /^(?:GET|HEAD)$/i.test(method);
const reject = (): never => {
  throw new QuizRequestBlockedError();
};

/** Moodle rewrites static quiz JavaScript through its revisioned asset loader. */
function isStaticQuizJavaScript(request: QuizHttpRequest, target?: URL): boolean {
  if (!target || !readMethod(request.method) || request.postData !== null) return false;
  const prefix = /^(.*)\/mod\/quiz\/view\.php$/.exec(target.pathname)?.[1];
  if (prefix === undefined) return false;
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }
  if (url.origin !== target.origin || url.username || url.password || url.search || url.hash)
    return false;
  // URL parsing normalizes dot segments; reject them in the original input too.
  const rawPath = request.url.split(/[?#]/, 1)[0]!;
  if (/[\\%]/.test(rawPath) || /\/(?:\.|\.\.)(?:\/|$)/.test(rawPath)) return false;
  const loader = `${prefix}/lib/javascript.php/`;
  if (!url.pathname.startsWith(loader)) return false;
  const match = /^\d+\/mod\/quiz\/(.+\.js)$/.exec(url.pathname.slice(loader.length));
  return Boolean(
    match &&
    match[1]!.split("/").every((segment) => /^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/.test(segment)),
  );
}

function requestDetails(request: QuizHttpRequest) {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return reject();
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname).toLowerCase();
  } catch {
    return reject();
  }
  const fields: Fields = [...url.searchParams.entries()];
  const body = request.postData;
  if (!/\/mod\/quiz\//.test(pathname) && !/mod_quiz_/i.test(url.search + (body ?? ""))) {
    return { url, pathname, fields, methods: [], quiz: false };
  }
  if (body?.trim()) {
    try {
      if (/^\s*[\[{]/.test(body)) {
        const visit = (value: unknown, name = "") => {
          if (value && typeof value === "object") {
            // PHP array/object coercion cannot establish a non-final scalar flag.
            if (finalFlag(name)) fields.push([`${name}[]`, ""]);
            for (const [key, child] of Object.entries(value))
              visit(child, Array.isArray(value) ? name : key);
          } else if (value !== null && value !== undefined)
            fields.push([name, typeof value === "boolean" ? (value ? "1" : "0") : String(value)]);
        };
        visit(JSON.parse(body));
      } else if (body.startsWith("--")) {
        const boundary = body.slice(0, body.indexOf("\r\n"));
        if (!boundary || (!body.endsWith(`${boundary}--\r\n`) && !body.endsWith(`${boundary}--`)))
          return reject();
        for (const part of body.split(boundary).slice(1, -1)) {
          const split = part.indexOf("\r\n\r\n");
          const header = part.slice(0, split);
          const name = /content-disposition:[^\r\n]*\bname="([^"\r\n]*)"/i.exec(header)?.[1];
          if (split < 0 || name === undefined) return reject();
          fields.push([name, part.slice(split + 4).replace(/\r\n$/, "")]);
        }
      } else {
        fields.push(...new URLSearchParams(body).entries());
      }
    } catch {
      return reject();
    }
  }
  const methods = fields
    .filter(([key]) => fieldName(key) === "methodname")
    .map(([, value]) => value);
  const quiz =
    /\/mod\/quiz\//.test(pathname) ||
    /mod_quiz_/i.test(url.search) ||
    methods.some((name) => /^mod_quiz_/i.test(name));
  return { url, pathname, fields, methods, quiz };
}

export function assertNoFinalQuizSubmission(request: QuizHttpRequest): void {
  // Non-quiz authentication/source traffic is unchanged. Quiz JSON/multipart is
  // parsed before admission so a disguised action cannot rely on a safe label.
  const details = requestDetails(request);
  if (!details.quiz) return;
  if (
    /\/(?:finish|finishattempt|submit|submitattempt|confirm_submission)(?:\.[a-z]+)?(?:\/|$)/.test(
      details.pathname,
    ) ||
    details.methods.some((name) => /^mod_quiz_.*(?:finish|submit)/i.test(name))
  )
    reject();
  if (!readMethod(request.method) && /\/summary\.php$/.test(details.pathname)) reject();
  for (const [key, value] of details.fields) {
    // Only literal empty/zero is safe for form/query/multipart strings. Typed
    // JSON false is normalized to zero above; text "false" is never trusted.
    if (finalFlag(key) && (key.includes("[") || (value !== "" && value !== "0"))) reject();
  }
}

/** Initial inspection cannot accidentally execute a page's auto-start script. */
export function createReadOnlyQuizRequestGuard(targetUrl?: string): QuizRequestGuard {
  const target = targetUrl ? new URL(targetUrl) : undefined;
  const quizPath = target
    ? /^(.*\/mod\/quiz)\/view\.php$/.exec(target.pathname)?.[1]?.toLowerCase()
    : undefined;
  return (request) => {
    assertNoFinalQuizSubmission(request);
    if (isStaticQuizJavaScript(request, target)) return;
    const { url, pathname, quiz } = requestDetails(request);
    if (!quiz) return;
    if (
      (target && url.origin !== target.origin) ||
      (quizPath && !pathname.startsWith(`${quizPath}/`)) ||
      !readMethod(request.method) ||
      !/\/mod\/quiz\//.test(pathname) ||
      /\/startattempt\.php(?:\/|$)/.test(pathname) ||
      (/\.php$/.test(pathname) && !/\/(?:view|review|attempt|summary)\.php$/.test(pathname))
    )
      reject();
  };
}

export function createFirstQuizAttemptRequestGuard(config: {
  targetUrl: string;
  loadBinding: () => Promise<{ attemptId: string } | null>;
  debitStartBeforeForward: () => Promise<void>;
  recordStartRedirect?: (proof: {
    attemptUrl: string;
    startUrl: string;
    status: 302 | 303;
  }) => Promise<void>;
}): QuizRequestGuard {
  const target = new URL(config.targetUrl);
  const cmid = target.searchParams.get("id");
  if (
    !/\/mod\/quiz\/view\.php$/.test(target.pathname) ||
    !cmid ||
    !/^\d+$/.test(cmid) ||
    target.username ||
    target.password
  )
    reject();
  const quizPath = target.pathname.slice(0, target.pathname.lastIndexOf("/"));
  let forwardedStart: string | null = null;
  let provisionalAttempt: string | null = null;
  return async (request) => {
    assertNoFinalQuizSubmission(request);
    if (isStaticQuizJavaScript(request, target)) return;
    const { url, pathname, fields, methods, quiz } = requestDetails(request);
    if (!quiz) return;
    if (
      url.origin !== target.origin ||
      url.username ||
      url.password ||
      (/\/mod\/quiz\//.test(pathname) && !pathname.startsWith(`${quizPath.toLowerCase()}/`))
    )
      reject();
    const binding = await config.loadBinding();
    const attempts = fields
      .filter(([key]) => /^(?:attempt|attemptid)$/.test(fieldName(key)))
      .map(([, value]) => value);
    if (pathname.endsWith("/startattempt.php")) {
      const ids = fields
        .filter(([key]) => /^(?:cmid|id)$/.test(fieldName(key)))
        .map(([, value]) => value);
      if (
        request.method.toUpperCase() !== "POST" ||
        binding ||
        forwardedStart ||
        attempts.length ||
        !ids.length ||
        ids.some((id) => id !== cmid)
      )
        reject();
      // This persistent, atomic debit must happen before route.continue(). A
      // failed/unknown response never releases it for another start.
      await config.debitStartBeforeForward();
      forwardedStart = url.toString();
      return;
    }
    if (pathname.endsWith("/view.php")) {
      if (!readMethod(request.method) || url.searchParams.get("id") !== cmid || attempts.length)
        reject();
      return;
    }
    const attemptPage = /\/(?:attempt|summary|review)\.php$/.test(pathname);
    const save =
      /\/(?:processattempt\.php|autosave\.ajax\.php)$/.test(pathname) ||
      (methods.length > 0 &&
        methods.every((name) =>
          /^mod_quiz_(?:save_attempt|autosave_attempt|get_attempt_data)$/i.test(name),
        ));
    if (!attemptPage && !save) {
      // Static quiz assets do not act on an attempt. Unknown quiz mutations do.
      if (!readMethod(request.method) || attempts.length || /\.php$/.test(pathname)) reject();
      return;
    }
    if (!attempts.length || attempts.some((id) => !/^\d+$/.test(id))) reject();
    const boundId = binding?.attemptId;
    if (
      !boundId &&
      !provisionalAttempt &&
      forwardedStart &&
      request.method.toUpperCase() === "GET" &&
      pathname.endsWith("/attempt.php") &&
      request.redirectedFrom?.method.toUpperCase() === "POST" &&
      request.redirectedFrom.url === forwardedStart &&
      attempts.every((id) => id === attempts[0])
    ) {
      if (config.recordStartRedirect) {
        const status = request.redirectedFrom?.status;
        if (status === 302 || status === 303) {
          await config.recordStartRedirect({
            attemptUrl: url.href,
            startUrl: forwardedStart,
            status,
          });
        } else reject();
      }
      provisionalAttempt = attempts[0]!;
    }
    if (!boundId && (!readMethod(request.method) || !attemptPage)) reject();
    const expected = boundId ?? provisionalAttempt;
    if (
      !expected ||
      attempts.some((id) => id !== expected) ||
      (boundId && provisionalAttempt && boundId !== provisionalAttempt)
    )
      reject();
    if (
      (attemptPage && !readMethod(request.method)) ||
      (save && request.method.toUpperCase() !== "POST")
    )
      reject();
  };
}
