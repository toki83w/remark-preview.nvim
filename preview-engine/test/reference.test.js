import assert from "node:assert/strict";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { createPreviewServer } from "../preview-server.js";
import { createKrokiCache } from "../remark-kroki-cache.js";
import { login, request, tempDir } from "./helpers.js";

// The reference document of the plugin: every feature, with what to expect. This test keeps it
// honest: when a feature stops working, or the document stops matching it, something here fails.
const examples = fileURLToPath(new URL("../../examples/", import.meta.url));
const vault = `${examples}vault/`;
const reference = `${vault}features.md`;

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20"/></svg>';
const fakeFetch = async () => new Response(SVG, { status: 200 });
const kroki = { fetch: fakeFetch, cache: createKrokiCache() };

async function launch() {
  try {
    const puppeteer = (await import("puppeteer")).default;
    return await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  } catch {
    return null;
  }
}

describe("reference document", () => {
  let app;
  let port;
  let cookie;
  let info;
  let page;
  let body;

  before(async () => {
    app = createPreviewServer({ kroki });
    port = await app.listen(0);
    cookie = await login(port, app.token);
    info = await app.open(reference);
    page = (await request(port, new URL(info.url).pathname, { headers: { Cookie: cookie } })).body;
    body = page.slice(page.indexOf('<div id="content">'));
  });
  after(() => app.shutdown());

  const count = (pattern) => (body.match(pattern) || []).length;
  const get = (path) => request(port, path, { headers: { Cookie: cookie } });

  test("renders without an error or a warning", () => {
    assert.match(page, /<div id="rp-error" hidden/);
    assert.doesNotMatch(page, /Diagram could not be rendered/);
  });

  test("the frontmatter is not shown, the HTML comment is not displayed", () => {
    assert.doesNotMatch(body, /reference, verification|tags:/);
    assert.match(page, /<title>Remark Preview reference<\/title>/);
  });

  test("text: emphasis, strikethrough, highlight, sub- and superscript, line breaks", () => {
    assert.ok(count(/<em>/g) >= 2 && count(/<strong>/g) >= 2 && count(/<del>/g) >= 1);
    assert.ok(count(/<mark>/g) >= 1);
    assert.ok(count(/<sub>/g) >= 2 && count(/<sup>/g) >= 2);
    assert.ok(count(/<br>/g) >= 2);
  });

  test("structure: headings, lists, tables, quotes, rules, footnotes", () => {
    for (const level of [1, 2, 3, 4, 5, 6]) {
      assert.ok(count(new RegExp(`<h${level}[ >]`, "g")) >= 1, `no h${level}`);
    }
    assert.ok(count(/<ol[ >]/g) >= 2 && count(/<ul[ >]/g) >= 3);
    assert.ok(count(/<table[ >]/g) >= 2);
    assert.ok(count(/<blockquote[ >]/g) >= 2);
    assert.ok(count(/<hr[ >]/g) >= 1);
    assert.equal(count(/data-footnotes/g), 1);
    assert.equal(count(/data-footnote-ref/g), 2);
  });

  test("task lists: standard and the three custom markers", () => {
    assert.ok(count(/task-list-item/g) >= 10);
    assert.ok(count(/task-important/g) === 1 && count(/task-question/g) === 1 && count(/task-ongoing/g) === 1);
    assert.ok(count(/<input type="checkbox" disabled checked>/g) >= 3);
  });

  test("code is highlighted, a block without language is not", () => {
    assert.ok(count(/hljs-keyword/g) >= 4);
    assert.ok(count(/hljs-addition/g) >= 1 && count(/hljs-deletion/g) >= 1);
    assert.ok(count(/<pre[ >]/g) >= 5);
  });

  test("math: LaTeX and AsciiMath, inline and display", () => {
    assert.equal(count(/class="katex-display"/g), 3);
    assert.equal(count(/class="katex"/g), 7);
  });

  test("callouts: the five alerts, the Obsidian types and two foldable ones", () => {
    const types = new Set([...body.matchAll(/data-callout="([^"]+)"/g)].map((m) => m[1]));
    for (const type of ["note", "tip", "important", "warning", "caution", "info", "question", "example", "success", "failure", "bug", "quote", "faq"]) {
      assert.ok(types.has(type), `missing callout type ${type}`);
    }
    assert.equal(count(/data-collapsible="true"/g), 2);
  });

  test("diagrams: mermaid (twice), plantuml, graphviz and a kroki type with an alt text", () => {
    assert.equal(count(/data:image\/svg\+xml;base64/g), 5);
    assert.match(body, /alt="A diagram drawn with nomnoml"/);
    assert.equal(count(/alt="mermaid"/g), 2);
    assert.equal(count(/class="rp-diagram"/g), 5, "every diagram is in a zoomable frame");
    assert.equal(count(/<span class="rp-diagram-controls">/g), 5);
  });

  test("images: six reachable references, three refused ones", () => {
    assert.equal(count(/<img[^>]*rp-blocked/g), 2, "outside the root, and hidden");
    assert.equal(count(/<img[^>]*rp-missing/g), 1);
    assert.match(body, /rp-blocked[^>]*title="[^"]*outside the project root/);
    assert.match(body, /title="[^"]*hidden files are not served/);
  });

  test("every served image answers 200 with an image type", async () => {
    const sources = [...body.matchAll(/<img[^>]*src="(\/d\/[0-9a-f]+\/f\/[^"]+)"/g)].map((m) => m[1]);
    assert.ok(sources.length >= 10, `only ${sources.length} served images`);
    for (const src of sources) {
      const res = await get(src);
      assert.equal(res.status, 200, src);
      assert.match(res.headers["content-type"], /^image\//, src);
    }
  });

  test("links: anchors stay anchors, other notes open their own preview, two are dead", () => {
    assert.match(body, /<a href="#math">/);
    assert.equal(count(/<a[^>]*rp-blocked/g), 1, "the text file");
    assert.equal(count(/<a[^>]*rp-missing/g), 1, "the missing note");
    assert.match(body, /href="mailto:someone@example\.org"/);
    assert.match(body, /<a href="https:\/\/example\.org\/reference" title="A title shown on hover">/);
  });

  test("every link to another note opens a preview that renders", async () => {
    const targets = new Set([...body.matchAll(/href="(\/d\/[0-9a-f]+\/)(?:#[^"]*)?"/g)].map((m) => m[1]));
    assert.ok(targets.size >= 2, "the linked note and the note in the deeper folder");
    const titles = [];
    for (const target of targets) {
      const res = await get(target);
      assert.equal(res.status, 200, target);
      titles.push(/<title>([^<]*)<\/title>/.exec(res.body)[1]);
    }
    assert.deepEqual(titles.sort(), ["Another note", "Linked note"]);
  });

  test("wikilinks: found by name, an alias, a heading, the same document, one unresolved", () => {
    assert.equal(count(/wikilink unresolved/g), 1);
    assert.ok(count(/class="wikilink"/g) >= 6);
    assert.match(body, /class="wikilink">an alias for the note<\/a>/);
    assert.match(body, /href="#wikilinks" class="wikilink"/);
    assert.match(body, /#second-heading" class="wikilink"/);
    // the only brackets left are the ones written inside code
    for (const match of body.matchAll(/\[\[[^\]]*\]\]/g)) {
      const before = body.slice(Math.max(0, match.index - 80), match.index);
      assert.match(before, /<code>[^<]*$/, `unconverted wikilink: ${match[0]}`);
    }
  });

  test("raw HTML is kept, a comment is not displayed as text", () => {
    assert.equal(count(/<kbd>/g), 2);
    assert.ok(count(/<details[ >]/g) >= 1);
    assert.match(body, /<summary>A collapsible section<\/summary>/);
    // the comment is in the HTML as a comment (invisible), never as text
    assert.equal(count(/An HTML comment/g), 1);
    assert.match(body, /<!-- An HTML comment/);
    assert.match(body, /<span style="color: #fe640b">/);
  });
});

test("in a browser every statement of the document holds", { timeout: 90000 }, async (t) => {
  const browser = await launch();
  if (!browser) {
    t.skip("Chrome/puppeteer not available");
    return;
  }
  // a copy: the test edits the document, the repository must never be touched
  const copy = tempDir("rp-reference-");
  cpSync(examples, copy.dir, { recursive: true });
  const document = join(copy.dir, "vault", "features.md");
  const app = createPreviewServer({ kroki });
  await app.listen(0);

  try {
    const info = await app.open(document);
    const tab = await browser.newPage();
    await tab.setViewport({ width: 1200, height: 800 });
    await tab.setRequestInterception(true);
    tab.on("request", (req) => (new URL(req.url()).hostname === "127.0.0.1" ? req.continue() : req.abort()));
    await tab.goto(info.url, { waitUntil: "load" });
    await tab.waitForFunction(() => document.getElementById("rp-status").className === "connected");

    // images: everything that has a source really loaded, the three refused ones have none
    const images = await tab.evaluate(() =>
      [...document.querySelectorAll("#content img")].map((img) => ({
        hasSrc: img.hasAttribute("src"),
        width: img.naturalWidth,
        refused: img.classList.contains("rp-blocked") || img.classList.contains("rp-missing"),
      })),
    );
    assert.equal(images.filter((i) => i.refused).length, 3);
    assert.ok(images.filter((i) => i.refused).every((i) => !i.hasSrc));
    assert.ok(images.filter((i) => !i.refused).every((i) => i.hasSrc && i.width > 0), "an image failed to load");
    assert.equal(images.length, 18);

    // sidebar lists headings of the levels one to four, once each
    const headings = await tab.evaluate(() => document.querySelectorAll("#content h1[id], #content h2[id], #content h3[id], #content h4[id]").length);
    assert.equal(await tab.evaluate(() => document.querySelectorAll(".toc-sidebar a").length), headings);

    // an HTML comment is not part of the visible text, frontmatter neither
    const visible = await tab.evaluate(() => document.getElementById("content").innerText);
    assert.doesNotMatch(visible, /An HTML comment|tags: \[/);
    assert.doesNotMatch(visible, /\$\$|^&&$/m, "math must be typeset, not shown as source");

    // anchor links scroll in place
    const path = await tab.evaluate(() => location.pathname);
    await tab.evaluate(() => [...document.querySelectorAll("a")].find((a) => a.textContent === "the math section").click());
    await tab.waitForFunction(() => window.scrollY > 300);
    assert.equal(await tab.evaluate(() => location.pathname), path);
    assert.equal(await tab.evaluate(() => location.hash), "#math");

    // a foldable callout and a details element open on a click
    const folded = await tab.evaluate(() => {
      const details = [...document.querySelectorAll("details")];
      return details.map((d) => d.open);
    });
    assert.ok(folded.includes(false) && folded.includes(true), "one closed and one open details element");

    // the live update marker: editing the file changes the page without reloading it
    await tab.evaluate(() => (window.__same = "yes"));
    const original = readFileSync(document, "utf8");
    assert.ok(original.includes("**edit this sentence and save**"), "the live update marker moved");
    writeFileSync(document, original.replace("**edit this sentence and save**", "**edited by the test**"));
    await app.update(document);
    await tab.waitForFunction(() => window.document.getElementById("content").innerText.includes("edited by the test"));
    assert.equal(await tab.evaluate(() => window.__same), "yes", "the page must not reload");
  } finally {
    await browser.close();
    await app.shutdown();
    copy.cleanup();
  }
});
