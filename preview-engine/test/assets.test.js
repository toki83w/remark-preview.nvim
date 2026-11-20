import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { createPreviewServer } from "../preview-server.js";
import { login, makeProject, PNG, request } from "./helpers.js";

describe("assets and links over HTTP", () => {
  let project;
  let app;
  let port;
  let cookie;
  let info;
  let base; // /d/<id>/f/

  before(async () => {
    project = makeProject();
    writeFileSync(
      project.doc,
      [
        "# Doc A",
        "",
        "![pic](img/pic.png) ![shared](../assets/shared.png)",
        "",
        '<img src="img/my%20pic.png" width="50">',
        "",
        "[to other](other.md#part) [anchor](#doc-a)",
        "",
        "![secret](../../outside/secret.png)",
        "",
      ].join("\n"),
    );
    app = createPreviewServer({ kroki: false });
    port = await app.listen(0);
    cookie = await login(port, app.token);
    info = await app.open(project.doc);
    base = `/d/${info.id}/f/`;
  });

  after(async () => {
    await app.shutdown();
    project.cleanup();
  });

  const get = (path, headers = {}, method = "GET") => request(port, path, { headers: { Cookie: cookie, ...headers }, method });
  const pagePath = () => new URL(info.url).pathname;

  test("the page references assets through the asset route and keeps anchors", async () => {
    const page = (await get(pagePath())).body;
    assert.match(page, new RegExp(`src="${base}docs/img/pic\\.png\\?m=\\d+"`));
    assert.match(page, new RegExp(`src="${base}assets/shared\\.png\\?m=\\d+"`));
    assert.match(page, new RegExp(`src="${base}docs/img/my%20pic\\.png\\?m=\\d+"`));
    assert.match(page, /<a href="#doc-a">anchor<\/a>/);
    assert.doesNotMatch(page, /<base/);
    assert.doesNotMatch(page, /src="[^"]*secret/);
  });

  test("serves an image with the right type and bytes", async () => {
    const res = await get(`${base}docs/img/pic.png`);
    assert.equal(res.status, 200);
    assert.equal(res.headers["content-type"], "image/png");
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.equal(Number(res.headers["content-length"]), PNG.length);
    assert.equal(Buffer.from(res.body, "latin1").length > 0, true);
  });

  test("serves an image from a sibling directory inside the project root", async () => {
    assert.equal((await get(`${base}assets/shared.png`)).status, 200);
  });

  test("serves names with spaces", async () => {
    assert.equal((await get(`${base}docs/img/my%20pic.png`)).status, 200);
  });

  test("answers HEAD without a body", async () => {
    const res = await get(`${base}docs/img/pic.png`, {}, "HEAD");
    assert.equal(res.status, 200);
    assert.equal(res.body, "");
    assert.equal(Number(res.headers["content-length"]), PNG.length);
  });

  test("supports byte ranges (needed to seek in media)", async () => {
    const res = await get(`${base}docs/img/pic.png`, { Range: "bytes=0-3" });
    assert.equal(res.status, 206);
    assert.equal(res.headers["content-range"], `bytes 0-3/${PNG.length}`);
    assert.equal(Number(res.headers["content-length"]), 4);
    const suffix = await get(`${base}docs/img/pic.png`, { Range: "bytes=-5" });
    assert.equal(suffix.headers["content-range"], `bytes ${PNG.length - 5}-${PNG.length - 1}/${PNG.length}`);
    assert.equal((await get(`${base}docs/img/pic.png`, { Range: "bytes=9999-" })).status, 416);
    assert.equal((await get(`${base}docs/img/pic.png`, { Range: "bytes=zz" })).status, 416);
  });

  test("requires the token cookie", async () => {
    assert.equal((await request(port, `${base}docs/img/pic.png`)).status, 401);
  });

  test("never serves files outside the project root", async () => {
    assert.equal((await get(`${base}docs/escape.png`)).status, 403, "symlink leading out");
    assert.equal((await get(`${base}..%2F..%2Foutside%2Fsecret.png`)).status, 403, "encoded traversal");
    // Literal ".." and "%2e%2e" are normalised away by the URL parser before routing: never served.
    for (const path of [
      `${base}%2e%2e/outside/secret.png`,
      `${base}../../outside/secret.png`,
      `${base}docs/../../outside/secret.png`,
    ]) {
      assert.ok([403, 404].includes((await get(path)).status), path);
    }
  });

  test("never serves hidden files or directories", async () => {
    assert.equal((await get(`${base}.env`)).status, 403);
    assert.equal((await get(`${base}.git/config`)).status, 403);
    assert.equal((await get(`${base}.hidden/x.png`)).status, 403);
  });

  test("only serves media file types", async () => {
    assert.equal((await get(`${base}docs/notes.txt`)).status, 403);
    assert.equal((await get(`${base}docs/a.md`)).status, 403);
  });

  test("answers 404 for missing files and directories", async () => {
    assert.equal((await get(`${base}docs/img/nope.png`)).status, 404);
    assert.equal((await get(`${base}docs/img.png`)).status, 404);
  });

  test("rejects malformed paths", async () => {
    assert.equal((await get(`${base}docs/%ZZ.png`)).status, 400);
    assert.equal((await get(`${base}docs/a%00.png`)).status, 400);
  });

  test("sandboxes svg files so they cannot run scripts when opened directly", async () => {
    writeFileSync(join(project.proj, "docs", "img", "d.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const res = await get(`${base}docs/img/d.svg`);
    assert.equal(res.status, 200);
    assert.equal(res.headers["content-type"], "image/svg+xml");
    assert.equal(res.headers["content-security-policy"], "sandbox");
  });

  test("a link to another markdown file opens its own, lazily rendered preview", async () => {
    const page = (await get(pagePath())).body;
    const link = /<a href="(\/d\/[0-9a-f]+\/#part)">to other<\/a>/.exec(page);
    assert.ok(link, "link was not rewritten");
    const target = link[1].replace("#part", "");
    assert.notEqual(target, pagePath());

    const other = await get(target);
    assert.equal(other.status, 200);
    assert.match(other.body, /<h1 id="other-doc">Other doc<\/h1>/);
    assert.match(other.body, /data-version="1"/);
  });

  test("the linked document serves assets from its own root", async () => {
    const page = (await get(pagePath())).body;
    const target = /<a href="(\/d\/[0-9a-f]+\/)#part">/.exec(page)[1];
    writeFileSync(project.other, "# Other doc\n\n![p](img/pic.png)\n");
    await app.update(project.other);
    const body = (await get(target)).body;
    const src = /src="([^"]+)"/.exec(body.slice(body.indexOf('<div id="content">')))[1];
    assert.equal((await get(src)).status, 200);
  });

  test("a document with a different root marker still cannot reach into this project", async () => {
    // other.md lives in the same project, so a link from outside its root must be refused
    const outsideDoc = join(project.dir, "outside", "doc.md");
    writeFileSync(outsideDoc, "![x](../proj/assets/shared.png)\n");
    const outside = await app.open(outsideDoc);
    const page = (await get(new URL(outside.url).pathname)).body;
    assert.match(page, /class="rp-blocked"/);
    assert.doesNotMatch(page, /src="[^"]*shared\.png/);
  });

  test("root_markers can be customised", async () => {
    const custom = createPreviewServer({ kroki: false, rootMarkers: [".nothing"] });
    const customPort = await custom.listen(0);
    try {
      // with no marker found the root is the document directory: ../assets is outside it
      const opened = await custom.open(project.doc);
      const customCookie = await login(customPort, custom.token);
      const page = await request(customPort, new URL(opened.url).pathname, { headers: { Cookie: customCookie } });
      assert.match(page.body, /src="[^"]*img\/pic\.png/);
      assert.doesNotMatch(page.body, /src="[^"]*shared\.png/);
      assert.match(page.body, /class="rp-blocked"/);
    } finally {
      await custom.shutdown();
    }
  });
});
