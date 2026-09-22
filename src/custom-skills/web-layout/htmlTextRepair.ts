import { parse, type DefaultTreeAdapterTypes } from "parse5";
import { z } from "zod";

const EditResponse = z.object({
  edits: z
    .array(z.object({ before: z.string().min(1).max(80_000), after: z.string().max(80_000) }))
    .min(1)
    .max(32),
});
export const htmlTextRepairSchema = z.toJSONSchema(EditResponse);

function protectedRanges(html: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const visit = (node: DefaultTreeAdapterTypes.Node) => {
    if (
      "tagName" in node &&
      node.tagName === "script" &&
      node.attrs.some(
        (attr) => attr.name === "type" && /application\/(?:ld\+)?json/i.test(attr.value),
      ) &&
      node.sourceCodeLocation
    ) {
      ranges.push({
        start: node.sourceCodeLocation.startOffset,
        end: node.sourceCodeLocation.endOffset,
      });
    }
    if ("childNodes" in node) node.childNodes.forEach(visit);
  };
  visit(parse(html, { sourceCodeLocationInfo: true }));
  return ranges;
}

/** Native workers receive presentation/runtime code without copying the learning banks. */
export function htmlTextRepairView(html: string): string {
  let view = html;
  for (const range of protectedRanges(html).reverse()) {
    view =
      view.slice(0, range.start) +
      "<!-- IMMUTABLE LEARNING DATA OMITTED -->" +
      view.slice(range.end);
  }
  return view;
}

/** Apply exact, unique replacements locally; never grant a worker arbitrary file access. */
export function applyHtmlTextRepair(html: string, response: string): string {
  const { edits } = EditResponse.parse(
    JSON.parse(response.replace(/^```(?:json)?\s*|\s*```$/g, "")),
  );
  const banks = protectedRanges(html).map((range) => html.slice(range.start, range.end));
  let result = html;
  for (const edit of edits) {
    const index = result.indexOf(edit.before);
    if (index < 0 || result.indexOf(edit.before, index + 1) >= 0)
      throw new Error("HTML repair must match exactly one existing fragment.");
    if (
      protectedRanges(result).some(
        (range) => index < range.end && index + edit.before.length > range.start,
      )
    )
      throw new Error("HTML repair cannot change embedded learning data.");
    result = result.slice(0, index) + edit.after + result.slice(index + edit.before.length);
  }
  const repairedBanks = protectedRanges(result).map((range) =>
    result.slice(range.start, range.end),
  );
  if (JSON.stringify(banks) !== JSON.stringify(repairedBanks))
    throw new Error("HTML repair must preserve embedded learning data structure.");
  return result;
}
