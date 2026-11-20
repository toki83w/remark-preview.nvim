import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { copyFileSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { createPreviewServer } from "../preview-server.js";
import { login, makeProject, request, tempDir } from "./helpers.js";

const engine = (file) => fileURLToPath(new URL(`../${file}`, import.meta.url));

async function chromeAvailable() {
  try {
    const puppeteer = (await import("puppeteer")).default;
    const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

describe("print page", () => {
  let project;
  let app;
  let port;
  let cookie;
  let info;

  before(async () => {
    project = makeProject();
    writeFileSync(
      project.doc,
      "# Print me\n\nText with ![pic](img/pic.png) and [other](other.md).\n\n```js\nconst x = 1;\n```\n\n$a^2$\n",
    );
    app = createPreviewServer({ kroki: false });
    port = await app.listen(0);
    cookie = await login(port, app.token);
    info = await app.open(project.doc);
  });
  after(async () => {
    await app.shutdown();
    project.cleanup();
  });

  const printPath = () => `${new URL(info.url).pathname}print`;
  const get = (path, headers = {}) => request(port, path, { headers: { Cookie: cookie, ...headers } });

  test("is a plain page with the print theme: no scripts, no live parts, no highlighting", async () => {
    const res = await get(printPath());
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/html/);
    assert.match(res.body, /<html lang="en" class="print">/);
    assert.match(res.body, /<body class="print">/);
    assert.doesNotMatch(res.body, /<script/);
    assert.doesNotMatch(res.body, /<span id="rp-status"|<div id="rp-error"/, "no status dot or banner elements");
    assert.doesNotMatch(res.body, /hljs/, "code must not be highlighted in the print theme");
    assert.match(res.body, /<h1[^>]*>Print me<\/h1>/);
    assert.match(res.body, /class="katex"/);
  });

  test("uses the print stylesheet, not the screen theme", async () => {
    const screen = (await get(new URL(info.url).pathname)).body;
    const print = (await get(printPath())).body;
    const printCss = readFileSync(engine("print.css"), "utf8").slice(0, 200);
    assert.ok(print.includes(printCss), "print.css must be inlined");
    assert.ok(!screen.includes(printCss));
    assert.doesNotMatch(print, /@scope \(\.dark\)/);
  });

  test("resolves images and links like the preview does", async () => {
    const res = await get(printPath());
    assert.match(res.body, new RegExp(`src="/d/${info.id}/f/docs/img/pic\\.png\\?m=\\d+"`));
    assert.match(res.body, /<a href="\/d\/[0-9a-f]+\/">other<\/a>/);
  });

  test("is rendered again on every request, from the file on disk", async () => {
    writeFileSync(project.doc, "# Changed on disk\n");
    assert.match((await get(printPath())).body, /Changed on disk/);
  });

  test("needs the token cookie", async () => {
    assert.equal((await request(port, printPath())).status, 401);
  });

  test("an unreadable document is an error, not an empty page", async () => {
    const gone = join(project.proj, "docs", "gone.md");
    writeFileSync(gone, "# soon gone\n");
    const opened = await app.open(gone);
    rmSync(gone);
    const res = await get(`/d/${opened.id}/print`);
    assert.equal(res.status, 500);
    assert.match(res.body, /Cannot read/);
  });

  test("an unknown document is a 404", async () => {
    assert.equal((await get("/d/deadbeef/print")).status, 404);
  });

  test("the live page is unchanged by the print mode", async () => {
    const res = await get(new URL(info.url).pathname);
    assert.match(res.body, /<span id="rp-status"/);
    assert.match(res.body, /\/_\/client\.js/);
  });
});

describe("PDF export", () => {
  let project;
  let hasChrome;
  before(async () => {
    project = makeProject();
    hasChrome = await chromeAvailable();
  });
  after(() => project.cleanup());

  test("writes a PDF with the content and the images of the document", { timeout: 90000 }, async (t) => {
    if (!hasChrome) {
      return t.skip("Chrome/puppeteer not available");
    }
    writeFileSync(project.doc, "# Export\n\nText.\n\n![pic](img/pic.png)\n\n![shared](../assets/shared.png)\n");
    const app = createPreviewServer({ kroki: false });
    await app.listen(0);
    const out = join(project.dir, "out.pdf");
    try {
      assert.equal(await app.exportPdf({ path: project.doc, out }), out);
      const pdf = readFileSync(out);
      assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
      assert.ok(pdf.length > 1000);
      assert.ok(pdf.includes("/Subtype /Image") || pdf.includes("/Subtype/Image"), "the images must be in the PDF");
    } finally {
      await app.shutdown();
    }
  });

  test("works for a document that is not open in a preview", { timeout: 90000 }, async (t) => {
    if (!hasChrome) {
      return t.skip("Chrome/puppeteer not available");
    }
    const app = createPreviewServer({ kroki: false });
    await app.listen(0);
    const out = join(project.dir, "other.pdf");
    try {
      await app.exportPdf({ path: project.other, out, format: "Letter", margin: "2cm" });
      assert.ok(statSync(out).size > 1000);
    } finally {
      await app.shutdown();
    }
  });

  test("a document that cannot be read is reported with the reason", { timeout: 90000 }, async (t) => {
    if (!hasChrome) {
      return t.skip("Chrome/puppeteer not available");
    }
    const app = createPreviewServer({ kroki: false });
    await app.listen(0);
    try {
      await assert.rejects(
        app.exportPdf({ path: join(project.proj, "docs", "missing.md"), out: join(project.dir, "m.pdf") }),
        /answered 500: Cannot read/,
      );
    } finally {
      await app.shutdown();
    }
  });

  test("a relative output path is refused", async () => {
    const app = createPreviewServer({ kroki: false });
    await app.listen(0);
    try {
      await assert.rejects(app.exportPdf({ path: project.doc, out: "relative.pdf" }), /must be absolute/);
    } finally {
      await app.shutdown();
    }
  });

  describe("without puppeteer", () => {
    const tmp = tempDir("rp-nopptr-");
    // a copy of the script in a directory where "puppeteer" cannot be resolved
    const script = join(tmp.dir, "export.js");
    before(() => {
      copyFileSync(engine("export.js"), script);
      writeFileSync(join(tmp.dir, "package.json"), '{"type":"module"}');
    });
    after(() => tmp.cleanup());

    test("the script says so and exits with code 3", async () => {
      const child = spawn(process.execPath, [script, "http://127.0.0.1:1/", join(tmp.dir, "x.pdf")], { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk) => (stderr += chunk));
      const [code] = await once(child, "close");
      assert.equal(code, 3);
      assert.match(stderr, /puppeteer is not installed/);
    });

    test("the server passes that message on", async () => {
      const app = createPreviewServer({ kroki: false, exportScript: script });
      await app.listen(0);
      try {
        await assert.rejects(
          app.exportPdf({ path: project.doc, out: join(project.dir, "np.pdf") }),
          /puppeteer is not installed/,
        );
      } finally {
        await app.shutdown();
      }
    });
  });

  test("a failing export script is reported", async () => {
    const tmp = tempDir("rp-badexp-");
    const script = join(tmp.dir, "export.js");
    writeFileSync(script, 'console.error("something broke"); process.exit(1);\n');
    const app = createPreviewServer({ kroki: false, exportScript: script });
    await app.listen(0);
    try {
      await assert.rejects(app.exportPdf({ path: project.doc, out: join(project.dir, "b.pdf") }), /something broke/);
    } finally {
      await app.shutdown();
      tmp.cleanup();
    }
  });

  test("shutting down stops an export that is still running", async () => {
    const tmp = tempDir("rp-slowexp-");
    const script = join(tmp.dir, "export.js");
    writeFileSync(script, "setTimeout(() => {}, 60000);\n");
    const app = createPreviewServer({ kroki: false, exportScript: script });
    await app.listen(0);
    try {
      const pending = app.exportPdf({ path: project.doc, out: join(project.dir, "s.pdf") });
      const outcome = assert.rejects(pending, /export failed|exit code/);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await app.shutdown();
      await outcome;
    } finally {
      tmp.cleanup();
    }
  });
});

describe("export through the server process", () => {
  test("does not hold up the other messages while it runs", { timeout: 90000 }, async (t) => {
    const project = makeProject();
    const slowTmp = tempDir("rp-slow-");
    const child = spawn(process.execPath, [engine("server.js")], {
      stdio: ["pipe", "pipe", "inherit"],
      env: { ...process.env },
    });
    const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
    const read = async () => JSON.parse((await lines.next()).value);
    const send = (message) => child.stdin.write(JSON.stringify(message) + "\n");
    const exited = once(child, "exit");
    try {
      await read(); // ready
      send({ type: "open", path: project.doc });
      assert.equal((await read()).type, "opened");

      send({ type: "export", path: project.other, out: join(slowTmp.dir, "slow.pdf") });
      send({ type: "update", path: project.doc });
      const first = await read();
      assert.equal(first.type, "updated", "the update must be answered while the export is still running");

      const second = await read();
      assert.ok(["exported", "error"].includes(second.type), JSON.stringify(second));
      if (second.type === "exported") {
        assert.equal(second.out, join(slowTmp.dir, "slow.pdf"));
        assert.equal(second.path, project.other);
        assert.ok(statSync(second.out).size > 1000);
      }

      child.stdin.end();
      assert.equal((await exited)[0], 0);
    } catch (error) {
      if (!(await chromeAvailable())) {
        return t.skip("Chrome/puppeteer not available");
      }
      throw error;
    } finally {
      child.kill();
      slowTmp.cleanup();
      project.cleanup();
    }
  });

  test("answers a bad export request with an error naming the document", async () => {
    const project = makeProject();
    const child = spawn(process.execPath, [engine("server.js")], { stdio: ["pipe", "pipe", "inherit"] });
    const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
    const read = async () => JSON.parse((await lines.next()).value);
    const exited = once(child, "exit");
    try {
      await read();
      child.stdin.write(JSON.stringify({ type: "export", path: project.doc, out: "relative.pdf" }) + "\n");
      const reply = await read();
      assert.equal(reply.type, "error");
      assert.equal(reply.path, project.doc);
      assert.match(reply.message, /must be absolute/);
      child.stdin.end();
      await exited;
    } finally {
      child.kill();
      project.cleanup();
    }
  });
});
