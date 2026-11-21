import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createPreviewServer } from "../preview-server.js";
import { createKrokiCache } from "../remark-kroki-cache.js";
import { makeProject, tempDir } from "./helpers.js";

// Real-browser check of the live swap. Skipped when Chrome is not available.
async function launch() {
  try {
    const puppeteer = (await import("puppeteer")).default;
    return await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  } catch {
    return null;
  }
}

const longDoc = (heading, marker) =>
  `# ${heading}\n\n${marker}\n\n## Part\n\n` + Array.from({ length: 80 }, (_, i) => `Paragraph ${i}.\n`).join("\n");

test("the page morphs on update without reloading and keeps the scroll position", { timeout: 90000 }, async (t) => {
  const browser = await launch();
  if (!browser) {
    t.skip("Chrome/puppeteer not available");
    return;
  }

  const tmp = tempDir();
  const doc = join(tmp.dir, "live.md");
  writeFileSync(doc, longDoc("First title", "initial marker"));
  const app = createPreviewServer({ kroki: false });
  const port = await app.listen(0);

  try {
    const info = await app.open(doc);
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    // Only the preview server is reachable: no CDN access in tests.
    page.on("request", (req) => (new URL(req.url()).hostname === "127.0.0.1" ? req.continue() : req.abort()));

    await page.goto(info.url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#content h1");
    await page.waitForFunction(() => document.getElementById("rp-status").className === "connected");

    assert.equal(await page.evaluate(() => document.body.className), "dark");
    assert.equal(await page.evaluate(() => document.querySelectorAll(".toc-sidebar a").length), 2);

    // Mark the document and scroll down: a reload would lose both.
    await page.evaluate(() => {
      window.__marker = "same page";
      window.scrollTo({ top: 400, behavior: "instant" });
    });
    assert.equal(await page.evaluate(() => window.scrollY), 400);

    writeFileSync(doc, longDoc("Second title", "updated marker"));
    await app.update(doc);
    await page.waitForFunction(() => document.querySelector("#content h1").textContent === "Second title");

    assert.equal(await page.evaluate(() => window.__marker), "same page", "page must not reload");
    assert.equal(await page.evaluate(() => window.scrollY), 400, "scroll position must be kept");
    assert.equal(await page.evaluate(() => document.title), "Second title");
    assert.match(await page.evaluate(() => document.getElementById("content").textContent), /updated marker/);
    assert.equal(
      await page.evaluate(() => document.querySelector(".toc-sidebar a").textContent),
      "Second title",
      "sidebar must be rebuilt",
    );

    // A failing render shows the banner on top of the last good content.
    rmSync(doc);
    await app.update(doc);
    await page.waitForFunction(() => !document.getElementById("rp-error").hidden);
    assert.match(await page.evaluate(() => document.getElementById("rp-error").textContent), /Cannot read/);
    assert.equal(await page.evaluate(() => document.querySelector("#content h1").textContent), "Second title");

    writeFileSync(doc, longDoc("Third title", "recovered marker"));
    await app.update(doc);
    await page.waitForFunction(() => document.getElementById("rp-error").hidden);
    assert.equal(await page.evaluate(() => document.querySelector("#content h1").textContent), "Third title");
    assert.equal(await page.evaluate(() => window.__marker), "same page");
  } finally {
    await browser.close();
    await app.shutdown();
    tmp.cleanup();
  }
});

test("two documents open in two pages update independently", { timeout: 90000 }, async (t) => {
  const browser = await launch();
  if (!browser) {
    t.skip("Chrome/puppeteer not available");
    return;
  }

  const tmp = tempDir();
  const docA = join(tmp.dir, "a.md");
  const docB = join(tmp.dir, "b.md");
  writeFileSync(docA, "# Alpha\n\nA one\n");
  writeFileSync(docB, "# Beta\n\nB one\n");
  const app = createPreviewServer({ kroki: false });
  await app.listen(0);

  try {
    const infoA = await app.open(docA);
    const infoB = await app.open(docB);
    const open = async (info) => {
      const page = await browser.newPage();
      await page.setRequestInterception(true);
      page.on("request", (req) => (new URL(req.url()).hostname === "127.0.0.1" ? req.continue() : req.abort()));
      await page.goto(info.url, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.getElementById("rp-status").className === "connected");
      return page;
    };
    const pageA = await open(infoA);
    const pageB = await open(infoB);

    writeFileSync(docA, "# Alpha\n\nA two\n");
    await app.update(docA);
    await pageA.waitForFunction(() => document.getElementById("content").textContent.includes("A two"));
    // Give B the chance to (wrongly) change.
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.match(await pageB.evaluate(() => document.getElementById("content").textContent), /B one/);
  } finally {
    await browser.close();
    await app.shutdown();
    tmp.cleanup();
  }
});

test("images load, anchors scroll in place and links open the other preview", { timeout: 90000 }, async (t) => {
  const browser = await launch();
  if (!browser) {
    t.skip("Chrome/puppeteer not available");
    return;
  }

  const project = makeProject();
  const filler = Array.from({ length: 60 }, (_, i) => `Paragraph ${i}.\n`).join("\n");
  writeFileSync(
    project.doc,
    [
      "# Top",
      "",
      "[jump](#bottom) [other](other.md) ![p](img/pic.png)",
      "",
      '<img id="raw" src="../assets/shared.png">',
      "",
      "![blocked](../../outside/secret.png)",
      "",
      filler,
      "## Bottom",
      "",
      "the end",
      "",
    ].join("\n"),
  );
  const app = createPreviewServer({ kroki: false });
  await app.listen(0);

  try {
    const info = await app.open(project.doc);
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (req) => (new URL(req.url()).hostname === "127.0.0.1" ? req.continue() : req.abort()));
    await page.goto(info.url, { waitUntil: "load" });
    await page.waitForSelector("#content h1");

    // images from the document dir, a sibling dir and raw HTML really load; the blocked one does not
    const widths = await page.evaluate(() =>
      [...document.querySelectorAll("#content img")].map((img) => [img.getAttribute("alt") || img.id, img.naturalWidth]),
    );
    assert.deepEqual(
      widths.sort(),
      [["blocked", 0], ["p", 1], ["raw", 1]],
      "unexpected image loading state",
    );
    assert.equal(await page.evaluate(() => document.querySelector("img.rp-blocked").hasAttribute("src")), false);

    // an anchor scrolls the page and does not navigate away (the old <base> bug)
    const before = await page.evaluate(() => location.pathname);
    await page.evaluate(() => [...document.querySelectorAll("a")].find((a) => a.textContent === "jump").click());
    await page.waitForFunction(() => window.scrollY > 100);
    assert.equal(await page.evaluate(() => location.pathname), before);
    assert.equal(await page.evaluate(() => location.hash), "#bottom");

    // a link to another markdown file navigates to that document's preview
    await Promise.all([
      page.waitForNavigation({ waitUntil: "load" }),
      page.evaluate(() => [...document.querySelectorAll("a")].find((a) => a.textContent === "other").click()),
    ]);
    assert.notEqual(await page.evaluate(() => location.pathname), before);
    await page.waitForSelector("#content h1");
    assert.equal(await page.evaluate(() => document.querySelector("#content h1").textContent), "Other doc");
    await page.waitForFunction(() => document.getElementById("rp-status").className === "connected");
  } finally {
    await browser.close();
    await app.shutdown();
    project.cleanup();
  }
});

test("a diagram has a real height inside its stamped paragraph, and warnings show as a banner", { timeout: 90000 }, async (t) => {
  const browser = await launch();
  if (!browser) {
    t.skip("Chrome/puppeteer not available");
    return;
  }

  const tmp = tempDir();
  const doc = join(tmp.dir, "diagram.md");
  writeFileSync(doc, "# Diagram\n\n```mermaid\ngraph TD; A-->B\n```\n\nafter\n");
  let fail = false;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120"/></svg>';
  const fakeFetch = async () => (fail ? new Response("boom", { status: 500 }) : new Response(svg, { status: 200 }));
  const app = createPreviewServer({ kroki: { fetch: fakeFetch, cache: createKrokiCache() } });
  await app.listen(0);

  try {
    const info = await app.open(doc);
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (req) => (new URL(req.url()).hostname === "127.0.0.1" ? req.continue() : req.abort()));
    await page.goto(info.url, { waitUntil: "load" });
    await page.waitForFunction(() => document.getElementById("rp-status").className === "connected");

    // the paragraph that carries the source lines is as tall as the diagram, so scroll sync can use it
    const height = await page.evaluate(() => document.querySelector("#content p[data-line='3']").getBoundingClientRect().height);
    assert.ok(height >= 120, `stamped paragraph is only ${height}px high`);
    assert.equal(await page.evaluate(() => document.getElementById("rp-error").hidden), true);

    // a failing diagram turns into a warning banner while the document keeps updating
    fail = true;
    writeFileSync(doc, "# Diagram\n\n```mermaid\ngraph TD; A-->C\n```\n\nchanged text\n");
    await app.update(doc);
    await page.waitForFunction(() => !document.getElementById("rp-error").hidden);
    assert.equal(await page.evaluate(() => document.getElementById("rp-error").className), "warning");
    assert.match(await page.evaluate(() => document.getElementById("rp-error").textContent), /Diagram "mermaid" \(line 3\)/);
    assert.match(await page.evaluate(() => document.getElementById("content").textContent), /changed text/);

    // fixed: the banner disappears on the next save
    fail = false;
    await app.update(doc);
    await page.waitForFunction(() => document.getElementById("rp-error").hidden);
  } finally {
    await browser.close();
    await app.shutdown();
    tmp.cleanup();
  }
});

test("a diagram can be panned and zoomed, and keeps its view across live updates", { timeout: 90000 }, async (t) => {
  const browser = await launch();
  if (!browser) {
    t.skip("Chrome/puppeteer not available");
    return;
  }

  const tmp = tempDir();
  const doc = join(tmp.dir, "zoom.md");
  const source = (text) => `# Zoom\n\n${text}\n\n\`\`\`mermaid\ngraph TD; A-->B\n\`\`\`\n`;
  writeFileSync(doc, source("first text"));
  // a diagram bigger than the page, so that it has to be fitted
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1000"><rect width="2000" height="1000"/></svg>';
  const app = createPreviewServer({ kroki: { fetch: async () => new Response(svg), cache: createKrokiCache() } });
  await app.listen(0);

  try {
    const info = await app.open(doc);
    const page = await browser.newPage();
    await page.setViewport({ width: 1000, height: 800 });
    await page.setRequestInterception(true);
    page.on("request", (req) => (new URL(req.url()).hostname === "127.0.0.1" ? req.continue() : req.abort()));
    await page.goto(info.url, { waitUntil: "load" });
    await page.waitForFunction(() => document.getElementById("rp-status").className === "connected");

    const view = () => page.evaluate(() => document.querySelector(".rp-diagram")._view);
    const box = async () => {
      const r = await page.evaluate(() => {
        const b = document.querySelector(".rp-diagram").getBoundingClientRect();
        return { x: b.x, y: b.y, w: b.width, h: b.height };
      });
      return { cx: r.x + r.w / 2, cy: r.y + r.h / 2, ...r };
    };

    // it starts fitted: smaller than the original size, and inside its frame
    const start = await view();
    assert.ok(start.s < 1 && start.s > 0, `expected a scale below 1, got ${start.s}`);
    const frame = await box();
    assert.ok(frame.w <= 1000, "the frame must not be wider than the page");

    // a drag pans
    await page.mouse.move(frame.cx, frame.cy);
    await page.mouse.down();
    await page.mouse.move(frame.cx + 40, frame.cy + 25, { steps: 4 });
    await page.mouse.up();
    const panned = await view();
    assert.equal(Math.round(panned.x - start.x), 40);
    assert.equal(Math.round(panned.y - start.y), 25);
    assert.equal(panned.s, start.s);

    // the plain wheel scrolls the page and does not zoom
    await page.mouse.wheel({ deltaY: -100 });
    assert.equal((await view()).s, start.s, "a plain wheel must not zoom");

    // Ctrl+wheel zooms
    await page.keyboard.down("Control");
    await page.mouse.wheel({ deltaY: -100 });
    await page.keyboard.up("Control");
    assert.ok((await view()).s > start.s, "Ctrl+wheel must zoom in");

    // the buttons zoom out and reset
    await page.click('.rp-diagram-controls button[data-act="out"]');
    const out = await view();
    await page.click('.rp-diagram-controls button[data-act="in"]');
    assert.ok((await view()).s > out.s);
    await page.click('.rp-diagram-controls button[data-act="reset"]');
    assert.deepEqual(await view(), start);

    // the view survives a live update that does not touch the diagram
    await page.mouse.move(frame.cx, frame.cy);
    await page.mouse.down();
    await page.mouse.move(frame.cx + 30, frame.cy, { steps: 3 });
    await page.mouse.up();
    const before = await view();
    writeFileSync(doc, source("second text"));
    await app.update(doc);
    await page.waitForFunction(() => document.getElementById("content").textContent.includes("second text"));
    assert.deepEqual(await view(), before, "the view must be kept");
    assert.match(await page.evaluate(() => document.querySelector(".rp-diagram-viewport").style.transform), /translate\(/);

    // the frame can be resized with the mouse (resize: both), and a save keeps the size
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector(".rp-diagram")).resize), "both");
    // the browser writes the size as inline width and height when the corner is dragged
    await page.evaluate(() => {
      const f = document.querySelector(".rp-diagram");
      f.style.width = "400px";
      f.style.height = "300px";
    });
    const resized = await box();
    assert.equal(Math.round(resized.w), 400);
    assert.equal(Math.round(resized.h), 300, "the 70vh cap must not apply once resized");
    const kept = await view();
    writeFileSync(doc, source("third text"));
    await app.update(doc);
    await page.waitForFunction(() => document.getElementById("content").textContent.includes("third text"));
    const after = await box();
    assert.equal(Math.round(after.w), 400, "the width must be kept on update");
    assert.equal(Math.round(after.h), 300, "the height must be kept on update");
    assert.deepEqual(await view(), kept, "resizing must not change the zoom and pan");

    // a press in the resize corner starts no pan
    await page.mouse.move(after.x + after.w - 6, after.y + after.h - 6);
    await page.mouse.down();
    await page.mouse.move(after.x + after.w - 30, after.y + after.h - 30, { steps: 3 });
    await page.mouse.up();
    assert.deepEqual(await view(), kept, "the corner must not pan");

    // the print page has no script, and in print media the controls are hidden (as in the PDF)
    const print = await browser.newPage();
    await print.setRequestInterception(true);
    print.on("request", (req) => (new URL(req.url()).hostname === "127.0.0.1" ? req.continue() : req.abort()));
    await print.goto(info.url.replace(/\/(\?|$)/, "/print$1"), { waitUntil: "load" });
    assert.equal(await print.evaluate(() => document.querySelectorAll("script").length), 0, "the print page runs no script");
    await print.emulateMediaType("print");
    assert.equal(await print.evaluate(() => getComputedStyle(document.querySelector(".rp-diagram-controls")).display), "none");
  } finally {
    await browser.close();
    await app.shutdown();
    tmp.cleanup();
  }
});

test("diagrams drawn by the real local tools have a visible size in the page", { timeout: 90000 }, async (t) => {
  const { createLocalRenderers } = await import("../local-diagrams.js");
  const local = createLocalRenderers();
  if (!local.mermaid && !local.plantuml) {
    t.skip("neither merman-cli nor plantuml is installed");
    return;
  }
  const browser = await launch();
  if (!browser) {
    t.skip("Chrome/puppeteer not available");
    return;
  }

  const tmp = tempDir();
  const doc = join(tmp.dir, "local.md");
  writeFileSync(
    doc,
    "# Local\n\n```mermaid\ngraph TD; A[Edit]-->B{Save?}\n```\n\n```plantuml\n@startuml\nAlice -> Bob: hi\n@enduml\n```\n",
  );
  // no Kroki server: whatever is drawn here was drawn by the tools
  const app = createPreviewServer({ kroki: { server: "http://127.0.0.1:1", local } });
  await app.listen(0);

  try {
    const info = await app.open(doc);
    const page = await browser.newPage();
    await page.setViewport({ width: 900, height: 900 });
    await page.setRequestInterception(true);
    page.on("request", (req) => (new URL(req.url()).hostname === "127.0.0.1" ? req.continue() : req.abort()));
    await page.goto(info.url, { waitUntil: "load" });
    await page.waitForFunction(() => document.getElementById("rp-status").className === "connected");

    const frames = await page.evaluate(() =>
      [...document.querySelectorAll(".rp-diagram")].map((frame) => {
        const img = frame.querySelector("img");
        const box = img.getBoundingClientRect();
        return { alt: img.alt, natural: img.naturalWidth, width: box.width, height: box.height };
      }),
    );
    const expected = ["mermaid", "plantuml"].filter((type) => local[type]);
    assert.deepEqual(frames.map((f) => f.alt), expected);
    for (const frame of frames) {
      assert.ok(frame.natural > 0, `${frame.alt}: the image did not load`);
      assert.ok(frame.width > 40 && frame.height > 40, `${frame.alt} is drawn ${frame.width}x${frame.height}: invisible`);
    }
    assert.equal(await page.evaluate(() => document.getElementById("rp-error").hidden), true, "no diagram may be reported as failed");
  } finally {
    await browser.close();
    await app.shutdown();
    tmp.cleanup();
  }
});
