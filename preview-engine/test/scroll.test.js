import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { createPreviewServer } from "../preview-server.js";
import { login, openSse, request, tempDir } from "./helpers.js";

const serverScript = fileURLToPath(new URL("../server.js", import.meta.url));

describe("scroll messages", () => {
  const tmp = tempDir();
  const doc = join(tmp.dir, "s.md");
  let app;
  let port;
  let cookie;
  let info;

  before(async () => {
    writeFileSync(doc, "# Scroll\n\ntext\n");
    app = createPreviewServer({ kroki: false });
    port = await app.listen(0);
    cookie = await login(port, app.token);
    info = await app.open(doc);
  });
  after(async () => {
    await app.shutdown();
    tmp.cleanup();
  });

  test("a scroll request reaches the viewers of that document only", async () => {
    const other = join(tmp.dir, "other.md");
    writeFileSync(other, "# Other\n");
    const otherInfo = await app.open(other);
    const viewer = openSse(port, `/d/${info.id}/events?v=1`, { Cookie: cookie });
    const bystander = openSse(port, `/d/${otherInfo.id}/events?v=1`, { Cookie: cookie });
    await viewer.ready;
    await bystander.ready;

    assert.equal(app.scroll(doc, 12), 1);
    assert.deepEqual((await viewer.next("scroll")).data, { line: 12 });
    assert.ok(await bystander.none("scroll"));
    viewer.close();
    bystander.close();
  });

  test("without a connected viewer nobody is told", async () => {
    // the server notices the closed streams of the previous test asynchronously
    const deadline = Date.now() + 3000;
    while (app.scroll(doc, 3) !== 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(app.scroll(doc, 3), 0);
  });

  test("an unknown document is an error", () => {
    assert.throws(() => app.scroll(join(tmp.dir, "unknown.md"), 3), /No preview open/);
  });

  test("the process answers scroll messages with the number of viewers", { timeout: 60000 }, async () => {
    const child = spawn(process.execPath, [serverScript], { stdio: ["pipe", "pipe", "inherit"] });
    const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
    const read = async () => JSON.parse((await lines.next()).value);
    const send = (message) => child.stdin.write(JSON.stringify(message) + "\n");
    const exited = once(child, "exit");
    try {
      const ready = await read();
      send({ type: "open", path: doc });
      const opened = await read();
      const childCookie = await login(ready.port, ready.token);

      send({ type: "scroll", path: doc, line: 5 });
      assert.deepEqual(await read(), { type: "scrolled", path: doc, viewers: 0 });

      const viewer = openSse(ready.port, `/d/${opened.id}/events?v=1`, { Cookie: childCookie });
      await viewer.ready;
      send({ type: "scroll", path: doc, line: 7 });
      assert.deepEqual(await read(), { type: "scrolled", path: doc, viewers: 1 });
      assert.deepEqual((await viewer.next("scroll")).data, { line: 7 });
      viewer.close();

      for (const line of [0, -1, 1.5, "3", null]) {
        send({ type: "scroll", path: doc, line });
        assert.equal((await read()).type, "error", `line ${JSON.stringify(line)} must be refused`);
      }
      send({ type: "scroll", path: join(tmp.dir, "nope.md"), line: 3 });
      assert.equal((await read()).type, "error");

      child.stdin.end();
      assert.equal((await exited)[0], 0);
    } finally {
      child.kill();
    }
  });

  test("the scripts needed by the page are served", async () => {
    const sync = await request(port, "/_/sync.js", { headers: { Cookie: cookie } });
    assert.equal(sync.status, 200);
    assert.match(sync.body, /lineToOffset/);
    const page = await request(port, new URL(info.url).pathname, { headers: { Cookie: cookie } });
    assert.ok(page.body.indexOf("/_/sync.js") < page.body.indexOf("/_/client.js"), "sync.js must load first");
  });
});

// Real-browser check of the placement. Skipped when Chrome is not available.
async function launch() {
  try {
    const puppeteer = (await import("puppeteer")).default;
    return await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  } catch {
    return null;
  }
}

// 60 sections of 4 lines each with a 21-line code block after section 29. The first line of every
// section and of the code block is recorded in `at`, so that the tests never count lines by hand.
function longDocument(firstLine = 1) {
  const lines = [];
  const at = {};
  const add = (...newLines) => lines.push(...newLines);
  for (let i = 0; i < 60; i++) {
    if (i === 30) {
      at.code = firstLine + lines.length;
      add("```text", ...Array.from({ length: 19 }, (_, j) => `code line ${j}`), "```", "");
    }
    at[`Section ${i}`] = firstLine + lines.length;
    add(`## Section ${i}`, "", `Paragraph of section ${i}.`, "");
  }
  return { text: lines.join("\n") + "\n", at };
}

// Smooth scrolling can start late on a fresh page: wait for the condition itself, not for quiet.
async function waitFor(page, description, measure, accept) {
  const deadline = Date.now() + 10000;
  let value;
  for (;;) {
    value = await page.evaluate(measure);
    if (accept(value) || Date.now() > deadline) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(accept(value), `${description}: measured ${value}`);
  return value;
}

test("the page scrolls to the requested source line", { timeout: 90000 }, async (t) => {
  const browser = await launch();
  if (!browser) {
    t.skip("Chrome/puppeteer not available");
    return;
  }
  const tmp = tempDir();
  const doc = join(tmp.dir, "long.md");
  const { text, at } = longDocument();
  writeFileSync(doc, text);
  const app = createPreviewServer({ kroki: false });
  await app.listen(0);

  try {
    const info = await app.open(doc);
    const page = await browser.newPage();
    await page.setViewport({ width: 1000, height: 600 });
    await page.setRequestInterception(true);
    page.on("request", (req) => (new URL(req.url()).hostname === "127.0.0.1" ? req.continue() : req.abort()));
    await page.goto(info.url, { waitUntil: "load" });
    await page.waitForFunction(() => document.getElementById("rp-status").className === "connected");

    // Distance from the top of the window of the heading with this text, as a browser expression.
    const headingTop = (name) =>
      `(() => [...document.querySelectorAll("#content h2")].find((h) => h.textContent === ${JSON.stringify(name)}).getBoundingClientRect().top)()`;
    const aboutAThird = (value) => Math.abs(value - 200) < 60; // a 600px window

    // The heading ends up about a third of the way down the window.
    app.scroll(doc, at["Section 40"]);
    await waitFor(page, "Section 40", headingTop("Section 40"), aboutAThird);

    // Scrolling back up works the same.
    app.scroll(doc, at["Section 5"]);
    await waitFor(page, "Section 5", headingTop("Section 5"), aboutAThird);

    // Inside a long block the position is proportional: the middle line of the code block
    // (21 lines, from the opening to the closing fence) lands a third down the window.
    const codeMiddle =
      '(() => { const r = document.querySelector("#content pre").getBoundingClientRect(); return r.top + r.height / 2; })()';
    app.scroll(doc, at.code + 10);
    await waitFor(page, "middle of the code block", codeMiddle, aboutAThird);

    // A line beyond the end scrolls to the bottom.
    app.scroll(doc, 100000);
    await waitFor(
      page,
      "distance to the bottom",
      "document.documentElement.scrollHeight - window.scrollY - window.innerHeight",
      (distance) => distance < 3,
    );

    // After the document changed (taller content), the positions are measured again.
    const intro = "# Header\n\n" + "Intro paragraph.\n\n".repeat(15);
    const introLines = 2 + 15 * 2;
    const changed = longDocument(introLines + 1);
    writeFileSync(doc, intro + changed.text);
    await app.update(doc);
    await page.waitForFunction(() => document.querySelector("#content h1")?.textContent === "Header");
    app.scroll(doc, changed.at["Section 40"]);
    await waitFor(page, "Section 40 after the document changed", headingTop("Section 40"), aboutAThird);
  } finally {
    await browser.close();
    await app.shutdown();
    tmp.cleanup();
  }
});
