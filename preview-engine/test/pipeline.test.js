import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { render } from "../pipeline.js";

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

// Kroki is disabled everywhere in this file: no network in tests.
const opts = { kroki: false };

test("renders headings with slug ids, collects headings and title", async () => {
  const { html, headings, title } = await render(fixture("features.md"), opts);
  assert.match(html, /<h1[^>]*id="main-title"[^>]*>Main Title<\/h1>/);
  assert.match(html, /<h2[^>]*id="section-one"[^>]*>Section One<\/h2>/);
  assert.equal(title, "Main Title");
  assert.deepEqual(
    headings.map((h) => [h.depth, h.id, h.text]),
    [
      [1, "main-title", "Main Title"],
      [2, "section-one", "Section One"],
      [2, "section-two", "Section Two"],
    ],
  );
});

test("strips yaml frontmatter", async () => {
  const { html } = await render(fixture("features.md"), opts);
  assert.doesNotMatch(html, /Frontmatter must not show/);
  assert.doesNotMatch(html, /tags:/);
});

test("renders GFM tables and does not use single tilde strikethrough", async () => {
  const { html } = await render("| a | b |\n|---|---|\n| 1 | 2 |\n\n~~gone~~ and ~sub~", opts);
  assert.match(html, /<table[ >]/);
  assert.match(html, /<del>gone<\/del>/);
  assert.match(html, /<sub>sub<\/sub>/);
});

test("renders standard and custom task markers", async () => {
  const { html } = await render(fixture("features.md"), opts);
  assert.match(html, /<input type="checkbox" disabled> \nopen task/);
  assert.match(html, /<input type="checkbox" disabled checked> \ndone task/);
  assert.match(html, /class="task-list-item custom-task task-important"/);
  assert.match(html, /class="task-list-item custom-task task-question"/);
  assert.match(html, /class="task-list-item custom-task task-ongoing"/);
  // the custom marker text must be removed
  assert.doesNotMatch(html, /\[!\] important/);
});

test("renders mark, subscript and superscript", async () => {
  const { html } = await render("==marked== H~2~O 10m^2^", opts);
  assert.match(html, /<mark>marked<\/mark>/);
  assert.match(html, /H<sub>2<\/sub>O/);
  assert.match(html, /10m<sup>2<\/sup>/);
});

test("renders latex math, display math and ampersand (asciimath) math with KaTeX", async () => {
  const { html } = await render(fixture("features.md"), opts);
  assert.match(html, /<annotation encoding="application\/x-tex">\\displaystyle\{ a \^\{ 2 \}/);
  assert.match(html, /class="katex-display"/);
  // ampersand math: x^2 and E = mc^2 are converted from asciimath
  assert.match(html, /ampersand math <span class="katex">/);
  assert.match(html, /E = m c \^\{ 2 \}/);
});

test("renders callouts", async () => {
  const { html } = await render("> [!NOTE]\n> A note callout.\n", opts);
  assert.match(html, /class="callout" data-callout="note"/);
  assert.match(html, /A note callout\./);
});

test("highlights code for dark/light themes but not for print", async () => {
  const src = "```js\nconst x = 1;\n```\n";
  const dark = await render(src, { ...opts, theme: "dark" });
  const print = await render(src, { ...opts, theme: "print" });
  assert.match(dark.html, /hljs-keyword/);
  assert.doesNotMatch(print.html, /hljs/);
});

test("returns a fragment, not a full document", async () => {
  const { html } = await render("# Hi\n", opts);
  assert.doesNotMatch(html, /<html|<head|<body|<base/);
});

test("repeated renders with the shared processor are independent", async () => {
  const a = await render("# One\n", opts);
  const b = await render("# Two\n", opts);
  assert.equal(a.title, "One");
  assert.equal(b.title, "Two");
});
