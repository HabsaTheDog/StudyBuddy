# Demo video script

Target length: 2:40–2:55. Record in English, use voice narration, and keep the final public YouTube video at or below three minutes. Use a synthetic or expressly authorized course and remove personal data, institution logos, and copyrighted music.

## 0:00–0:18 — The problem

**On screen:** Study Buddy home screen and a short view of the safe demo workspace.

**Narration:**

> University information is scattered across course portals, schedules, files, quizzes, and calendars. Before students can study, they often have to figure out where the information is. I built Study Buddy to guide them through that entire environment.

## 0:18–0:38 — What Study Buddy is

**On screen:** Enter a request such as “Create an interactive study guide for the upcoming demo exam and tell me which sources you used.”

**Narration:**

> Study Buddy is an open-source local learning companion. It can navigate authorized student portals, find course and schedule information, answer questions, and turn course sources into structured PDF or offline interactive study guides.

## 0:38–1:18 — Live workflow

**On screen:** Show the workflow progress: course discovery, source acquisition, coverage, analysis, and artifact building. Do not show credentials or real personal URLs.

**Narration:**

> Here it identifies the correct course, gathers the available evidence, and records what it could and could not cover. It does not treat one empty portal result as proof that information is unavailable. The workflow can use Moodle, CIS, or calendar data depending on the question, and it keeps every run isolated in the student's workspace.

## 1:18–1:48 — Result

**On screen:** Open a selected interactive guide. Use chapter navigation, answer one practice item, and show sources. Briefly show a PDF example.

**Narration:**

> The result is not just a summary. It organizes learning goals, explanations, worked examples, practice, and source coverage. Interactive guides work as one offline HTML file, while the document workflow creates validated Typst PDFs. Students can keep both locally.

## 1:48–2:08 — Safety and trust

**On screen:** Show coverage information and a quiz or assignment confirmation card without performing a real consequential action.

**Narration:**

> Study Buddy is intentionally conservative. It exposes incomplete evidence, requires visible permission for consequential quiz and assignment actions, and blocks final Moodle quiz submission. Its planned analytics are opt-in and content-free, and the production tracking setup will be completed before the student alpha.

## 2:08–2:32 — GPT-5.6 inside the product

**On screen:** Show the model policy documentation or a clean architecture graphic with Luna, Terra, and Sol roles.

**Narration:**

> GPT-5.6 is part of the running product. Study Buddy routes coordination, source analysis, artifact planning, building, and quality review through task-specific GPT-5.6 policies. Faster models handle bounded work, while stronger models and reasoning levels are used for difficult artifacts and validation recovery.

## 2:32–2:52 — How Codex built it

**On screen:** Briefly show the primary Codex thread, a relevant diff, and the passing test output.

**Narration:**

> I built Study Buddy with Codex as my primary engineering collaborator. During Build Week it helped me extend the LangGraph runtime, integrate the T3 interface, implement source and safety policies, diagnose real failures, and build a large regression suite. I made the product decisions around student experience, privacy, source fidelity, and action boundaries.

## 2:52–2:58 — Close

**On screen:** Study Buddy logo, repository name, and “Education — OpenAI Build Week 2026.”

**Narration:**

> Study Buddy is free and open source. It is designed for Linux, macOS, and Windows, and I plan to begin the student alpha in September after completing cross-platform validation.

## Recording checklist

- Use the exact final submitted commit.
- Keep credentials, calendar URLs, account names, and personal course data off screen.
- Show a real working result, not only slides.
- Mention Codex and GPT-5.6 separately and specifically.
- Show Codex briefly if possible.
- Use voiceover; do not substitute background music for narration.
- Export below three minutes and upload publicly to YouTube.
