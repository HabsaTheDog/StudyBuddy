import { describe, expect, it } from "vitest";
import { applyHtmlTextRepair, htmlTextRepairView } from "../htmlTextRepair.js";

describe("provider-independent HTML repairs", () => {
  const bank = `<script id="question-bank" type="application/json">${JSON.stringify({ questions: ["private-evidence".repeat(30_000)] })}</script>`;
  const html = `<!doctype html><html><head><style>.card{width:900px}</style></head><body>${bank}<script>console.log('ready')</script></body></html>`;
  it("omits large immutable banks from the repair prompt while preserving executable code", () => {
    const view = htmlTextRepairView(html);
    expect(view.length).toBeLessThan(500);
    expect(view).not.toContain("private-evidence");
    expect(view).toContain("console.log('ready')");
  });
  it("applies a local CSS repair and preserves the complete original learning bank", () => {
    const repaired = applyHtmlTextRepair(
      html,
      JSON.stringify({
        edits: [{ before: ".card{width:900px}", after: ".card{width:min(900px,100%)}" }],
      }),
    );
    expect(repaired).toContain(bank);
    expect(repaired).toContain("width:min(900px,100%)");
  });
  it("rejects edits that hide the original learning bank inside a new script", () => {
    expect(() => applyHtmlTextRepair(html, JSON.stringify({edits:[{before:"</head><body>",after:"</head><body><script>"}]}))).toThrow("preserve embedded learning data structure");
  });
  it("rejects ambiguous, invented, and content-changing replacements", () => {
    for (const before of ["script", "missing-fragment", bank]) {
      expect(() =>
        applyHtmlTextRepair(html, JSON.stringify({ edits: [{ before, after: "" }] })),
      ).toThrow();
    }
  });
});
