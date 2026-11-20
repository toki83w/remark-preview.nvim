import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { render } from "../pipeline.js";
import { makeProject } from "./helpers.js";

describe("url rewriting in rendered documents", () => {
  let project;
  let ctx;
  before(() => {
    project = makeProject();
    ctx = {
      kroki: false,
      links: {
        root: project.proj,
        docDir: join(project.proj, "docs"),
        assetBase: "/d/abc/f/",
        docLink: () => "/d/other/",
      },
    };
  });
  after(() => project.cleanup());

  const html = async (markdown) => (await render(markdown, ctx)).html;

  test("markdown images are rewritten to the asset route", async () => {
    assert.match(await html("![x](img/pic.png)"), /<img src="\/d\/abc\/f\/docs\/img\/pic\.png\?m=\d+" alt="x">/);
  });

  test("images written as raw HTML are rewritten and keep their attributes", async () => {
    const out = await html('<img src="../assets/shared.png" width="100" alt="raw">');
    assert.match(out, /src="\/d\/abc\/f\/assets\/shared\.png\?m=\d+"/);
    assert.match(out, /width="100"/);
    assert.match(out, /alt="raw"/);
  });

  test("anchor links stay anchors (no <base> to break them)", async () => {
    const out = await html("# Title\n\n[jump](#title)\n");
    assert.match(out, /<a href="#title">jump<\/a>/);
    assert.doesNotMatch(out, /<base/);
  });

  test("links to other markdown files open their preview", async () => {
    assert.match(await html("[o](other.md#sec)"), /<a href="\/d\/other\/#sec">o<\/a>/);
  });

  test("external links and images are untouched", async () => {
    const out = await html("[a](https://example.org/x) ![b](https://example.org/b.png)");
    assert.match(out, /href="https:\/\/example\.org\/x"/);
    assert.match(out, /src="https:\/\/example\.org\/b\.png"/);
  });

  test("blocked images lose their source and are marked", async () => {
    const out = await html("![s](../../outside/secret.png) ![e](../.env)");
    assert.doesNotMatch(out, /src="[^"]*(secret|\.env)/);
    assert.match(out, /class="rp-blocked"/);
    assert.match(out, /title="[^"]*outside the project root"/);
  });

  test("a missing image is marked as missing", async () => {
    const out = await html("![m](img/nope.png)");
    assert.match(out, /class="rp-missing"/);
    assert.doesNotMatch(out, /src=/);
  });

  test("without a link context nothing is rewritten", async () => {
    const out = (await render("![x](img/pic.png)", { kroki: false })).html;
    assert.match(out, /<img src="img\/pic\.png"/);
  });

  test("raw HTML keeps working in the other features", async () => {
    const out = await html("- [x] done\n\nH~2~O <kbd>Ctrl</kbd>\n");
    assert.match(out, /<input type="checkbox" disabled checked>/);
    assert.match(out, /H<sub>2<\/sub>O <kbd>Ctrl<\/kbd>/);
  });
});
