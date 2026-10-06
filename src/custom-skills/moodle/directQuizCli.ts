import { executeDirectQuiz } from "./directQuiz.js";
try {
  if (process.argv.length !== 3) throw Error("Pass exactly one JSON quiz operation.");
  const result = await executeDirectQuiz(JSON.parse(process.argv[2]!));
  process.stdout.write(JSON.stringify(result) + "\n");
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  const secrets = [
    process.env.MOODLE_USERNAME,
    process.env.MOODLE_PASSWORD,
    process.env.CIS_PASSWORD,
  ].filter((value): value is string => !!value);
  const message = error instanceof Error ? error.message : "Quiz operation failed.";
  process.stdout.write(
    JSON.stringify({
      ok: false,
      kind: "direct_quiz",
      error: secrets.reduce((text, secret) => text.replaceAll(secret, "[redacted]"), message),
    }) + "\n",
  );
  process.exitCode = 1;
}
