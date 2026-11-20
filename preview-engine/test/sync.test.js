import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, test } from "node:test";
import { render } from "../pipeline.js";

const { lineToOffset } = createRequire(import.meta.url)("../client/sync.cjs");

const lines = (html, tag) =>
  [...html.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)? data-line="(\\d+)" data-line-end="(\\d+)"`, "g"))].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ]);

describe("data-line stamps", () => {
  test("block elements carry their first and last source line", async () => {
    const md = ["# Title", "", "First", "second line.", "", "- one", "- two", "  more", "", "```js", "a;", "```", ""].join("\n");
    const { html } = await render(md, { kroki: false });
    assert.deepEqual(lines(html, "h1"), [[1, 1]]);
    assert.deepEqual(lines(html, "p"), [[3, 4]]);
    assert.deepEqual(lines(html, "ul"), [[6, 8]]);
    assert.deepEqual(lines(html, "li"), [[6, 6], [7, 8]]);
    assert.deepEqual(lines(html, "pre"), [[10, 12]]);
  });

  test("lines count from the top of the file, frontmatter included", async () => {
    const md = "---\ntitle: x\n---\n\n# After frontmatter\n";
    const { html } = await render(md, { kroki: false });
    assert.deepEqual(lines(html, "h1"), [[5, 5]]);
  });

  test("tables and blockquotes are stamped", async () => {
    const md = "| a | b |\n|---|---|\n| 1 | 2 |\n\n> quote\n> more\n";
    const { html } = await render(md, { kroki: false });
    assert.deepEqual(lines(html, "table"), [[1, 3]]);
    assert.deepEqual(lines(html, "blockquote"), [[5, 6]]);
  });

  test("generated elements without a source position are left alone", async () => {
    const { html } = await render("> [!NOTE]\n> text\n\nafter\n", { kroki: false });
    assert.doesNotMatch(html, /<div class="callout"[^>]*data-line/);
    assert.deepEqual(lines(html, "p"), [[4, 4]]);
  });
});

describe("lineToOffset", () => {
  // Three blocks: lines 1-2 (top 0, 100px), 4-8 (top 150, 500px), 10-10 (top 700, 50px).
  const entries = [
    { start: 1, end: 2, top: 0, height: 100 },
    { start: 4, end: 8, top: 150, height: 500 },
    { start: 10, end: 10, top: 700, height: 50 },
  ];

  test("returns null without elements", () => {
    assert.equal(lineToOffset([], 3), null);
    assert.equal(lineToOffset(null, 3), null);
  });

  test("a line inside an element is placed proportionally within it", () => {
    assert.equal(lineToOffset(entries, 4), 150);
    assert.equal(lineToOffset(entries, 6), 150 + (2 / 5) * 500);
    assert.equal(lineToOffset(entries, 8), 150 + (4 / 5) * 500);
    assert.equal(lineToOffset(entries, 1), 0);
    assert.equal(lineToOffset(entries, 2), 50);
  });

  test("a blank line between elements is placed between them", () => {
    // line 3 is the gap between the bottom of block 1 (100) and the top of block 2 (150)
    assert.equal(lineToOffset(entries, 3), 100 + 0.5 * 50);
    // line 9: from the bottom of block 2 (650) towards the top of block 3 (700)
    assert.equal(lineToOffset(entries, 9), 650 + 0.5 * 50);
  });

  test("a line after the last element ends at its bottom", () => {
    assert.equal(lineToOffset(entries, 11), 750);
    assert.equal(lineToOffset(entries, 500), 750);
  });

  test("a line before the first element is placed above it", () => {
    const shifted = [{ start: 5, end: 6, top: 200, height: 40 }];
    assert.equal(lineToOffset(shifted, 1), 0);
    assert.equal(lineToOffset(shifted, 3), 200 * (2 / 4));
  });

  test("nested elements: the innermost one starting at or before the line wins", () => {
    const nested = [
      { start: 1, end: 6, top: 0, height: 300 }, // list
      { start: 1, end: 2, top: 0, height: 100 }, // first item
      { start: 3, end: 6, top: 100, height: 200 }, // second item
    ];
    assert.equal(lineToOffset(nested, 4), 100 + (1 / 4) * 200);
    assert.equal(lineToOffset(nested, 2), 50);
  });

  test("is monotonic: later lines never map higher up", () => {
    let previous = -1;
    for (let line = 1; line <= 12; line++) {
      const offset = lineToOffset(entries, line);
      assert.ok(offset >= previous, `line ${line}: ${offset} < ${previous}`);
      previous = offset;
    }
  });
});
