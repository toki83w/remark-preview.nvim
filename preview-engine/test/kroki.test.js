import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { render } from "../pipeline.js";
import { createPreviewServer } from "../preview-server.js";
import { createKrokiCache } from "../remark-kroki-cache.js";
import { login, openSse, request, tempDir } from "./helpers.js";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';

/** A fake Kroki server. mode: "ok" answers with an svg, "error" with a 500, "hang" never answers. */
async function startKroki() {
  const calls = [];
  let mode = "ok";
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      calls.push({ method: req.method, url: req.url, type: req.headers["content-type"], body: Buffer.concat(chunks).toString() });
      if (mode === "hang") {
        return; // the client has to give up by itself
      }
      if (mode === "error") {
        res.writeHead(500, { "Content-Type": "text/plain" });
        return res.end("Error 500: syntax error in diagram\nmore details");
      }
      res.writeHead(200, { "Content-Type": "image/svg+xml" });
      res.end(SVG);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    calls,
    setMode: (value) => (mode = value),
    stop: () => new Promise((resolve) => (server.closeAllConnections(), server.close(resolve))),
  };
}

const decodeDataUrl = (html) => {
  const match = /src="data:image\/svg\+xml;base64,([^"]+)"/.exec(html);
  return match ? Buffer.from(match[1], "base64").toString() : null;
};

describe("kroki plugin", () => {
  let kroki;
  before(async () => {
    kroki = await startKroki();
  });
  after(() => kroki.stop());

  // The options object must be reused between renders (processors are cached by identity).
  const options = (extra = {}) => ({ kroki: { server: kroki.url, cache: createKrokiCache(), ...extra } });
  const diagram = (source = "graph TD; A-->B") => "```mermaid\n" + source + "\n```\n";

  test("a diagram becomes an inline svg image with the diagram type as alt", async () => {
    kroki.calls.length = 0;
    const { html, warnings } = await render(diagram(), options());
    assert.equal(decodeDataUrl(html), SVG);
    assert.match(html, /alt="mermaid"/);
    assert.deepEqual(warnings, []);
    assert.equal(kroki.calls.length, 1);
  });

  test("the request is a POST of the diagram source as text/plain to /<type>/svg", async () => {
    kroki.calls.length = 0;
    await render(diagram("graph LR; X-->Y"), options());
    assert.deepEqual(kroki.calls, [{ method: "POST", url: "/mermaid/svg", type: "text/plain", body: "graph LR; X-->Y" }]);
  });

  test("rehype-kroki-img-bg still wraps the image in a light box", async () => {
    const { html } = await render(diagram(), options());
    assert.match(html, /<span style="background:#fff;[^"]*"><img /);
  });

  test("the image sits inside its paragraph: no block element inside a <p>", async () => {
    const { html } = await render(diagram(), options());
    assert.doesNotMatch(html, /<p[^>]*><div/);
  });

  test("the source line of the block is kept for scroll sync", async () => {
    const { html } = await render("intro\n\n" + diagram(), options());
    assert.match(html, /<p data-line="3" data-line-end="5"><span style="background:#fff;[^"]*"><img /);
  });

  test("an identical diagram in a later render is served from the cache", async () => {
    kroki.calls.length = 0;
    const opts = options();
    await render(diagram(), opts);
    const second = await render(diagram(), opts);
    assert.equal(kroki.calls.length, 1, "the second render must not ask the server again");
    assert.equal(decodeDataUrl(second.html), SVG);
  });

  test("the same diagram twice in one document is requested once", async () => {
    kroki.calls.length = 0;
    await render(diagram() + "\n" + diagram(), options());
    assert.equal(kroki.calls.length, 1);
  });

  test("another source, type or server is another cache entry", async () => {
    kroki.calls.length = 0;
    const opts = options();
    await render(diagram("graph TD; A-->B"), opts);
    await render(diagram("graph TD; A-->C"), opts);
    await render("```graphviz\ndigraph { A -> B }\n```\n", opts);
    assert.equal(kroki.calls.length, 3);
    const other = await startKroki();
    try {
      await render(diagram("graph TD; A-->B"), { kroki: { server: other.url, cache: opts.kroki.cache } });
      assert.equal(other.calls.length, 1, "the cache is keyed by server too");
    } finally {
      await other.stop();
    }
  });

  test("a failure is reported, shows a placeholder and is never cached", async () => {
    kroki.calls.length = 0;
    const opts = options();
    kroki.setMode("error");
    const failed = await render(diagram(), opts);
    assert.match(decodeDataUrl(failed.html), /Diagram could not be rendered/);
    assert.match(decodeDataUrl(failed.html), /answered 500: Error 500: syntax error in diagram/);
    assert.equal(failed.warnings.length, 1);
    assert.match(failed.warnings[0], /^Diagram "mermaid" \(line 1\): the Kroki server answered 500: Error 500/);
    assert.equal(opts.kroki.cache.size, 0);

    // fixed without restarting anything: the next render asks again and succeeds
    kroki.setMode("ok");
    const recovered = await render(diagram(), opts);
    assert.equal(decodeDataUrl(recovered.html), SVG);
    assert.deepEqual(recovered.warnings, []);
    assert.equal(kroki.calls.length, 2);
    assert.equal(opts.kroki.cache.size, 1);
  });

  test("an unreachable server is a warning, not an exception", async () => {
    const dead = await startKroki();
    const url = dead.url;
    await dead.stop();
    const { html, warnings } = await render(diagram(), { kroki: { server: url, cache: createKrokiCache() } });
    assert.match(decodeDataUrl(html), /could not be rendered/);
    assert.match(warnings[0], /cannot reach the Kroki server \(ECONNREFUSED\)/);
  });

  test("a server that does not answer is given up on after the timeout", async () => {
    kroki.setMode("hang");
    try {
      const started = Date.now();
      const { warnings } = await render(diagram(), options({ timeoutMs: 300 }));
      assert.ok(Date.now() - started < 5000);
      assert.match(warnings[0], /did not answer within 0\.3s/);
    } finally {
      kroki.setMode("ok");
    }
  });

  test("other code blocks and empty diagram blocks are left alone", async () => {
    kroki.calls.length = 0;
    const { html, warnings } = await render("```js\nconst a = 1;\n```\n\n```mermaid\n\n```\n", options());
    assert.match(html, /<code class="hljs language-js">/);
    assert.equal(kroki.calls.length, 0);
    assert.deepEqual(warnings, []);
  });

  test("alt= sets the alt text", async () => {
    const { html } = await render('```mermaid alt="Flow of data"\ngraph TD; A-->B\n```\n', options());
    assert.match(html, /alt="Flow of data"/);
  });

  test("```kroki type=... draws any diagram type", async () => {
    kroki.calls.length = 0;
    const { html } = await render("```kroki type=plantuml\n@startuml\nA -> B\n@enduml\n```\n", options());
    assert.equal(kroki.calls[0].url, "/plantuml/svg");
    assert.match(html, /alt="plantuml"/);
  });

  test("a diagram type that is not a plain name never reaches the server", async () => {
    kroki.calls.length = 0;
    const { warnings } = await render("```kroki type=../admin\nx\n```\n", options());
    assert.equal(kroki.calls.length, 0);
    assert.match(warnings[0], /"\.\.\/admin" is not a valid diagram type/);
  });

  test("with diagrams switched off the block stays a code block", async () => {
    const { html } = await render(diagram(), { kroki: false });
    assert.match(html, /<pre/);
    assert.doesNotMatch(html, /data:image\/svg/);
  });
});

describe("kroki cache", () => {
  test("evicts the least recently used entry beyond its size", () => {
    const cache = createKrokiCache(2);
    cache.set("a", 1);
    cache.set("b", 2);
    assert.equal(cache.get("a"), 1); // a is now more recent than b
    cache.set("c", 3);
    assert.equal(cache.get("b"), undefined);
    assert.equal(cache.get("a"), 1);
    assert.equal(cache.get("c"), 3);
    assert.equal(cache.size, 2);
  });

  test("setting an existing key does not grow it", () => {
    const cache = createKrokiCache(2);
    cache.set("a", 1);
    cache.set("a", 2);
    assert.equal(cache.size, 1);
    assert.equal(cache.get("a"), 2);
  });

  test("a document with more diagrams than the cache holds still renders them all", async () => {
    const upstream = await startKroki();
    try {
      const cache = createKrokiCache(2);
      const source = [1, 2, 3, 4].map((n) => "```mermaid\ngraph TD; A-->N" + n + "\n```\n").join("\n");
      const { html, warnings } = await render(source, { kroki: { server: upstream.url, cache } });
      assert.equal(html.match(/data:image\/svg\+xml/g).length, 4);
      assert.deepEqual(warnings, []);
      assert.equal(cache.size, 2);
    } finally {
      await upstream.stop();
    }
  });
});

describe("diagram problems in the preview", () => {
  const tmp = tempDir();
  let kroki;
  let app;
  let port;
  let cookie;
  let doc;
  let info;

  before(async () => {
    kroki = await startKroki();
    doc = join(tmp.dir, "d.md");
    writeFileSync(doc, "# Diagrams\n\n```mermaid\ngraph TD; A-->B\n```\n");
    app = createPreviewServer({ kroki: { server: kroki.url, cache: createKrokiCache() } });
    port = await app.listen(0);
    cookie = await login(port, app.token);
    kroki.setMode("error");
    info = await app.open(doc);
  });
  after(async () => {
    await app.shutdown();
    await kroki.stop();
    tmp.cleanup();
  });

  test("a failing diagram shows a warning banner and the page is still delivered", async () => {
    const page = await request(port, new URL(info.url).pathname, { headers: { Cookie: cookie } });
    assert.equal(page.status, 200);
    assert.match(page.body, /<div id="rp-error" class="warning">Diagram &quot;mermaid&quot; \(line 3\)/);
    assert.match(page.body, /<h1[^>]*>Diagrams<\/h1>/);
  });

  test("fixing the Kroki server and saving again clears the warning, without restarting", async () => {
    const sse = openSse(port, `/d/${info.id}/events?v=${app.sessions.get(info.id).version}`, { Cookie: cookie });
    await sse.ready;
    kroki.setMode("ok");
    await app.update(doc);
    const update = await sse.next("update");
    assert.deepEqual(update.data.warnings, []);
    assert.match(update.data.html, /data:image\/svg\+xml/);
    const page = await request(port, new URL(info.url).pathname, { headers: { Cookie: cookie } });
    assert.match(page.body, /<div id="rp-error" hidden class="warning"><\/div>/);
    sse.close();
  });

  test("a new failure is announced to the viewers", async () => {
    const changed = join(tmp.dir, "changed.md");
    writeFileSync(changed, "# Changed\n\n```mermaid\ngraph TD; X-->Y\n```\n");
    const opened = await app.open(changed);
    const sse = openSse(port, `/d/${opened.id}/events?v=${app.sessions.get(opened.id).version}`, { Cookie: cookie });
    await sse.ready;
    kroki.setMode("error");
    writeFileSync(changed, "# Changed\n\n```mermaid\ngraph TD; X-->Z\n```\n");
    await app.update(changed);
    const update = await sse.next("update");
    assert.equal(update.data.warnings.length, 1);
    assert.match(update.data.warnings[0], /line 3/);
    sse.close();
    kroki.setMode("ok");
  });
});
