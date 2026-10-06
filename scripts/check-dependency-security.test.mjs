import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const { SourceMapConsumer } = createRequire(import.meta.url)("source-map-js");
const map = { version: 3, sources: ["input.js"], names: [], mappings: "AAAA" };
const indexed = (line, column = 0, nested = map) => ({
  version: 3,
  sections: [{ offset: { line, column }, map: nested }],
});

test("indexed source maps reject offsets that can exhaust the event loop", () => {
  for (const offset of [1_000_000_000, Infinity, NaN, -1, 0.5, "100"]) {
    assert.throws(() => new SourceMapConsumer(indexed(offset)), /Section offset/);
  }
  assert.throws(
    () => new SourceMapConsumer(indexed(6_000_000, 0, indexed(6_000_000))),
    /including offsets of nested sections/,
  );
});

test("ordinary indexed source maps retain their source mapping", () => {
  assert.equal(
    new SourceMapConsumer(indexed(10)).originalPositionFor({ line: 11, column: 1 }).source,
    "input.js",
  );
});
