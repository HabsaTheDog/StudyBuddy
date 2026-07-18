import { describe, expect, it } from "vitest";
import { balancedExcerpt, compactHtmlForModel } from "../modelText.js";

describe("model text compaction", () => {
  it("removes embedded base64 while preserving HTML after the asset", () => {
    const html = `<img src="data:image/png;base64,${"A".repeat(50_000)}"><script>const taskCount=25;</script>`;
    const compact = compactHtmlForModel(html);

    expect(compact).toContain("embedded binary omitted: 50000 chars");
    expect(compact).toContain("const taskCount=25");
    expect(compact).not.toContain("A".repeat(100));
  });

  it("samples the beginning, middle, and end of oversized structured text", () => {
    const source = ["HEAD", "A".repeat(10_000), "MIDDLE", "B".repeat(10_000), "TAIL"].join("\n");
    const excerpt = balancedExcerpt(source, 4_000);

    expect(excerpt).toContain("HEAD");
    expect(excerpt).toContain("TAIL");
    expect(excerpt).toContain("balanced excerpt 2/4");
  });
});
