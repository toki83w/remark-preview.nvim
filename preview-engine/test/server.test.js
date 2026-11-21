import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderShell } from "../shell.js";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { createPreviewServer } from "../preview-server.js";
import { login, openSse, request, tempDir } from "./helpers.js";

const serverScript = fileURLToPath(new URL("../server.js", import.meta.url));

describe("preview server", () => {
  const tmp = tempDir();
  let app;
  let port;
  let cookie;
  let a;
  let b;

  before(async () => {
    a = join(tmp.dir, "a.md");
    b = join(tmp.dir, "b.md");
    writeFileSync(a, "# Doc A\n\nfirst version of A\n");
    writeFileSync(b, "# Doc B\n\nbody of B\n");
    app = createPreviewServer({ kroki: false });
    port = await app.listen(0);
    cookie = await login(port, app.token);
  });

  after(async () => {
    await app.shutdown();
    tmp.cleanup();
  });

  const get = (path, headers = {}) => request(port, path, { headers: { Cookie: cookie, ...headers } });

  test("listens on loopback only, on an OS-assigned port", async () => {
    assert.ok(port > 0);
    assert.equal(app.address().address, "127.0.0.1");
    assert.equal(app.address().port, port);
  });

  test("serves the page shell with theme class, css and rendered content", async () => {
    const info = await app.open(a);
    const res = await get(new URL(info.url).pathname);
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/html/);
    assert.match(res.body, /<html lang="en" class="dark">/);
    assert.match(res.body, /<body class="dark">/);
    assert.match(res.body, /@scope \(\.dark\)/); // preview.css is inlined
    assert.match(res.body, /\.toc-sidebar/); // shell.css is inlined
    assert.match(res.body, /<h1[^>]*id="doc-a"[^>]*>Doc A<\/h1>/);
    assert.match(res.body, /<title>Doc A<\/title>/);
    assert.match(res.body, /data-version="1"/);
    assert.doesNotMatch(res.body, /<base/);
  });

  test("the github themes use github-markdown-css with the Catppuccin palette and code style", async () => {
    for (const [theme, hljs, palette] of [
      ["github-dark", "catppuccin-mocha.css", "--ctp-mocha-base"],
      ["github-light", "catppuccin-latte.css", "--ctp-latte-base"],
    ]) {
      const html = renderShell({ id: "x", theme, title: "t", html: "<p>hi</p>", version: 1 });
      assert.match(html, new RegExp(`<body class="${theme}">`));
      assert.match(html, /<div id="content" class="markdown-body">/);
      assert.match(html, new RegExp(`\\.${theme} \\{`));
      assert.ok(html.includes(hljs));
      assert.ok(html.includes(palette));
      assert.doesNotMatch(html, /@scope \(\.dark\)/);
    }
  });

  test("the theme picked in the page (cookie) wins over the configured one, an unknown value is ignored", async () => {
    const info = await app.open(a);
    const path = new URL(info.url).pathname;
    const picked = await get(path, { Cookie: `${cookie}; rp_theme=github-light` });
    assert.match(picked.body, /<body class="github-light">/);
    assert.match(picked.body, /<div id="content" class="markdown-body">/);
    const unknown = await get(path, { Cookie: `${cookie}; rp_theme=print` });
    assert.match(unknown.body, /<body class="dark">/);
  });

  test("serves morphdom and the client script", async () => {
    const morph = await get("/_/morphdom.js");
    assert.equal(morph.status, 200);
    assert.match(morph.body, /morphdom/);
    const client = await get("/_/client.js");
    assert.match(client.body, /EventSource/);
  });

  test("an update of one document reaches only its own event stream", async () => {
    const infoA = await app.open(a);
    const infoB = await app.open(b);
    const sseA = openSse(port, `/d/${infoA.id}/events?v=${app.sessions.get(infoA.id).version}`, { Cookie: cookie });
    const sseB = openSse(port, `/d/${infoB.id}/events?v=${app.sessions.get(infoB.id).version}`, { Cookie: cookie });
    assert.equal(await sseA.ready, 200);
    assert.equal(await sseB.ready, 200);

    writeFileSync(a, "# Doc A\n\nsecond version of A\n");
    await app.update(a);

    const event = await sseA.next("update");
    assert.match(event.data.html, /second version of A/);
    assert.equal(event.data.title, "Doc A");
    assert.equal(event.id, String(event.data.version));
    assert.ok(await sseB.none("update"), "document B must not receive A's update");

    sseA.close();
    sseB.close();
  });

  test("a viewer that missed an update is caught up on connect", async () => {
    const info = await app.open(a);
    const version = app.sessions.get(info.id).version;
    const stale = openSse(port, `/d/${info.id}/events?v=${version - 1}`, { Cookie: cookie });
    await stale.ready;
    const event = await stale.next("update");
    assert.equal(event.data.version, version);

    const current = openSse(port, `/d/${info.id}/events?v=${version}`, { Cookie: cookie });
    await current.ready;
    assert.ok(await current.none("update"));

    const reconnect = openSse(port, `/d/${info.id}/events?v=${version}`, {
      Cookie: cookie,
      "Last-Event-ID": String(version - 1),
    });
    await reconnect.ready;
    assert.equal((await reconnect.next("update")).data.version, version);

    stale.close();
    current.close();
    reconnect.close();
  });

  test("a failing render keeps the last good content and reports the error", async () => {
    const gone = join(tmp.dir, "gone.md");
    writeFileSync(gone, "# Gone soon\n\nstill here\n");
    const info = await app.open(gone);
    const sse = openSse(port, `/d/${info.id}/events?v=${app.sessions.get(info.id).version}`, { Cookie: cookie });
    await sse.ready;

    rmSync(gone);
    await app.update(gone);
    const failure = await sse.next("render-error");
    assert.match(failure.data.message, /Cannot read/);

    const page = await get(new URL(info.url).pathname);
    assert.match(page.body, /still here/);
    assert.match(page.body, /<div id="rp-error">Cannot read/);

    writeFileSync(gone, "# Back\n\nrecovered\n");
    await app.update(gone);
    assert.match((await sse.next("update")).data.html, /recovered/);
    sse.close();
  });

  test("closing a document ends its stream and removes the page", async () => {
    const tmpDoc = join(tmp.dir, "closing.md");
    writeFileSync(tmpDoc, "# Closing\n");
    const info = await app.open(tmpDoc);
    const sse = openSse(port, `/d/${info.id}/events?v=1`, { Cookie: cookie });
    await sse.ready;

    assert.equal(app.closeSession(tmpDoc), true);
    await sse.next("closed");
    assert.equal((await get(`/d/${info.id}/`)).status, 404);
    assert.equal(app.closeSession(tmpDoc), false);
  });

  test("redirects /d/<id> to /d/<id>/ and 404s unknown ids", async () => {
    const info = await app.open(b);
    const redirect = await get(`/d/${info.id}`);
    assert.equal(redirect.status, 301);
    assert.equal(redirect.headers.location, `/d/${info.id}/`);
    assert.equal((await get("/d/deadbeef/")).status, 404);
    assert.equal((await get("/nothing")).status, 404);
  });

  describe("security", () => {
    test("rejects a foreign Host header (DNS rebinding)", async () => {
      const res = await get("/_/client.js", { Host: "evil.example" });
      assert.equal(res.status, 403);
      const wrongPort = await get("/_/client.js", { Host: `127.0.0.1:${port + 1}` });
      assert.equal(wrongPort.status, 403);
    });

    test("accepts localhost as Host", async () => {
      const res = await get("/_/client.js", { Host: `localhost:${port}` });
      assert.equal(res.status, 200);
    });

    test("requires the token cookie", async () => {
      assert.equal((await request(port, "/_/client.js")).status, 401);
      assert.equal((await request(port, "/_/client.js", { headers: { Cookie: `rp_token_${port}=wrong` } })).status, 401);
    });

    test("exchanges a valid ?t= token for an HttpOnly SameSite=Strict cookie", async () => {
      const info = await app.open(a);
      const res = await request(port, `${new URL(info.url).pathname}?t=${app.token}`);
      assert.equal(res.status, 302);
      assert.equal(res.headers.location, new URL(info.url).pathname);
      const setCookie = res.headers["set-cookie"][0];
      assert.match(setCookie, /HttpOnly/);
      assert.match(setCookie, /SameSite=Strict/);
      assert.ok(setCookie.startsWith(`rp_token_${port}=${app.token};`));
    });

    test("rejects a wrong ?t= token", async () => {
      assert.equal((await request(port, "/?t=nope")).status, 401);
    });

    test("only GET and HEAD are allowed", async () => {
      const res = await request(port, "/_/client.js", { method: "POST", headers: { Cookie: cookie } });
      assert.equal(res.status, 405);
    });
  });
});

describe("server process", () => {
  test("speaks JSON lines on stdin/stdout and exits when stdin closes", { timeout: 60000 }, async () => {
    const tmp = tempDir();
    const doc = join(tmp.dir, "p.md");
    writeFileSync(doc, "# Process\n\nhello from the process\n");

    const child = spawn(process.execPath, [serverScript], { stdio: ["pipe", "pipe", "inherit"] });
    const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
    const read = async () => JSON.parse((await lines.next()).value);
    const exited = once(child, "exit");

    try {
      const ready = await read();
      assert.equal(ready.type, "ready");
      assert.ok(ready.port > 0);
      assert.ok(ready.token.length >= 32);

      child.stdin.write(JSON.stringify({ type: "open", path: doc }) + "\n");
      const opened = await read();
      assert.equal(opened.type, "opened");
      assert.ok(opened.url.startsWith(`http://127.0.0.1:${ready.port}/d/${opened.id}/?t=`));

      const cookie = await login(ready.port, ready.token);
      const page = await request(ready.port, `/d/${opened.id}/`, { headers: { Cookie: cookie } });
      assert.match(page.body, /hello from the process/);

      writeFileSync(doc, "# Process\n\nchanged\n");
      child.stdin.write(JSON.stringify({ type: "update", path: doc }) + "\n");
      const updated = await read();
      assert.deepEqual([updated.type, updated.version], ["updated", 2]);

      child.stdin.write(JSON.stringify({ type: "update", path: join(tmp.dir, "unknown.md") }) + "\n");
      assert.equal((await read()).type, "error");

      child.stdin.write("not json\n");
      assert.equal((await read()).type, "error");

      child.stdin.end();
      const [code] = await exited;
      assert.equal(code, 0);
    } finally {
      child.kill();
      tmp.cleanup();
    }
  });
});
