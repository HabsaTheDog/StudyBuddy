import {
  classifyStudyBuddyIntent,
  isExplicitQuizExecutionIntent,
} from "./taskIntent.js";

const mode = process.argv[2];
const prompt = process.argv.slice(3).join(" ").trim();

if (!prompt || (mode !== "--intent" && mode !== "--quiz-execution")) {
  console.error("Usage: taskIntentCli.ts --intent|--quiz-execution <prompt>");
  process.exit(2);
}

if (mode === "--quiz-execution") {
  process.exit(isExplicitQuizExecutionIntent(prompt) ? 0 : 1);
}

const decision = classifyStudyBuddyIntent({
  prompt,
  stage: "all",
  diagnosticOnly: false,
  autoAnswer: false,
  includeCis: true,
  hasCisUrls: true,
  hasCalendarUrl: true,
});

process.stdout.write(`${decision.intent}\n`);
