import { classifyStudyBuddyIntent } from "./taskIntent.js";

const prompt = process.argv.slice(2).join(" ").trim();

if (!prompt) {
  console.error("A non-empty prompt is required.");
  process.exit(2);
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
