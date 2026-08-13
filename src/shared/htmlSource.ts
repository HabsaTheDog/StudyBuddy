import { parse, type DefaultTreeAdapterTypes } from "parse5";

export interface HtmlSourceElement {
  tagName: string;
  attributes: ReadonlyMap<string, string>;
  attributeRanges: ReadonlyMap<string, { startOffset: number; endOffset: number }>;
  startOffset: number;
  endOffset: number;
  contentStartOffset: number;
  contentEndOffset: number;
  hasEndTag: boolean;
}

export interface HtmlSourceDocument {
  hasDoctype: boolean;
  elements: HtmlSourceElement[];
}

export interface HtmlSourceReplacement {
  startOffset: number;
  endOffset: number;
  value: string;
}

/**
 * Inspect HTML with the standards-compliant parse5 parser while retaining the
 * byte offsets needed to edit the original source without reserializing it.
 */
export function inspectHtmlSource(html: string): HtmlSourceDocument {
  const document = parse(html, { sourceCodeLocationInfo: true });
  const elements: HtmlSourceElement[] = [];
  let hasDoctype = false;

  const visit = (node: DefaultTreeAdapterTypes.Node): void => {
    if (node.nodeName === "#documentType") hasDoctype = true;
    if ("tagName" in node) {
      const location = node.sourceCodeLocation;
      if (location?.startTag) {
        const attributeRanges = new Map<string, { startOffset: number; endOffset: number }>();
        for (const [name, attributeLocation] of Object.entries(location.attrs ?? {})) {
          attributeRanges.set(name.toLowerCase(), {
            startOffset: attributeLocation.startOffset,
            endOffset: attributeLocation.endOffset,
          });
        }
        elements.push({
          tagName: node.tagName.toLowerCase(),
          attributes: new Map(node.attrs.map((attribute) => [attribute.name.toLowerCase(), attribute.value])),
          attributeRanges,
          startOffset: location.startOffset,
          endOffset: location.endOffset,
          contentStartOffset: location.startTag.endOffset,
          contentEndOffset: location.endTag?.startOffset ?? location.endOffset,
          hasEndTag: Boolean(location.endTag),
        });
      }
    }
    if ("childNodes" in node) {
      for (const child of node.childNodes) visit(child);
    }
    if ("content" in node) visit(node.content);
  };

  visit(document);
  return { hasDoctype, elements };
}

/** Apply non-overlapping source edits from right to left so offsets stay valid. */
export function replaceHtmlSourceRanges(
  html: string,
  replacements: readonly HtmlSourceReplacement[],
): string {
  const ordered = [...replacements].sort((left, right) => right.startOffset - left.startOffset);
  let previousStart = html.length;
  let result = html;
  for (const replacement of ordered) {
    if (
      replacement.startOffset < 0 ||
      replacement.endOffset < replacement.startOffset ||
      replacement.endOffset > html.length ||
      replacement.endOffset > previousStart
    ) {
      throw new Error("Invalid or overlapping HTML source replacement range.");
    }
    result = `${result.slice(0, replacement.startOffset)}${replacement.value}${result.slice(replacement.endOffset)}`;
    previousStart = replacement.startOffset;
  }
  return result;
}
