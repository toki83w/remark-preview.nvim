import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createPreviewServer } from "../preview-server.js";
import { tempDir } from "./helpers.js";

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
