const EMBEDDED_BASE64_PATTERN = /data:([^;,"'\s]+(?:;[^;,"'\s]+)*);base64,([A-Za-z0-9+/=\r\n]+)/g;

export function compactHtmlForModel(html: string, maxChars = 180_000): string {
  const withoutEmbeddedBinary = html.replace(
    EMBEDDED_BASE64_PATTERN,
    (_match, mediaType: string, payload: string) =>
      `data:${mediaType};base64,[embedded binary omitted: ${payload.length} chars]`,
  );
  return balancedExcerpt(withoutEmbeddedBinary, maxChars);
}

export function balancedExcerpt(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const chunkSize = Math.max(1, Math.floor(maxChars / 4));
  const starts = [
    0,
    Math.max(0, Math.floor(value.length / 3) - Math.floor(chunkSize / 2)),
    Math.max(0, Math.floor((value.length * 2) / 3) - Math.floor(chunkSize / 2)),
    Math.max(0, value.length - chunkSize),
  ];
  return starts.map((start, index) =>
    `<!-- balanced excerpt ${index + 1}/4 at ${start} -->\n${value.slice(start, start + chunkSize)}`
  ).join("\n\n<!-- omitted between balanced excerpts -->\n\n");
}
