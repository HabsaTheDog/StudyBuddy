import { executeDirectDocument } from "./directDocument.js";

try {
  if (process.argv.length !== 3) throw new Error("Usage: directDocumentCli.ts '<JSON>'");
  const result = await executeDirectDocument(JSON.parse(process.argv[2]));
  process.stdout.write(JSON.stringify(result) + "\n");
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, kind: "direct_document", error: error instanceof Error ? error.message : "Invalid document request." }) + "\n");
  process.exitCode = 1;
}
