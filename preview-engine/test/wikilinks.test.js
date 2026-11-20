import assert from "node:assert/strict";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { render } from "../pipeline.js";
import { createPreviewServer } from "../preview-server.js";
import { createVaultIndex, directoryWithin } from "../vault.js";
import { login, PNG, request, tempDir } from "./helpers.js";

/**
 * An Obsidian vault:
 *   .obsidian/  .trash/old.md  node_modules/pkg/readme.md
 *   Home.md  Daily/Home.md (a second note with the same name)  Daily/2024-01-02.md
 *   Notes/{Idea.md, Deep/Deep note.md}  Projects/{Alpha/Plan.md, Beta/Plan.md}
 *   Attachments/{pic.png, doc.pdf}  Notes/Deep/local.png
 */
function makeVault() {
  const tmp = tempDir("rp-vault-");
  const vault = join(tmp.dir, "vault");
  for (const dir of [".obsidian", ".trash", "node_modules/pkg", "Daily", "Notes/Deep", "Projects/Alpha", "Projects/Beta", "Attachments"]) {
    mkdirSync(join(vault, dir), { recursive: true });
  }
  const note = (path, text = `# ${path}\n`) => writeFileSync(join(vault, path), text);
  note(".trash/old.md");
  note("node_modules/pkg/readme.md");
  note("Home.md", "# Home\n\nroot home\n");
  note("Daily/Home.md", "# Daily home\n");
  note("Daily/2024-01-02.md", "# Day\n");
  note("Notes/Idea.md", "# Idea\n\n## Some Heading\n\ntext\n");
  note("Notes/Deep/Deep note.md", "# Deep note\n");
  note("Projects/Alpha/Plan.md", "# Alpha plan\n");
  note("Projects/Beta/Plan.md", "# Beta plan\n");
  note("Notes/Tom & Jerry.md", "# Tom\n");
  note("Notes/A & B & C.md", "# Letters\n");
  writeFileSync(join(vault, "Attachments", "pic.png"), PNG);
  writeFileSync(join(vault, "Attachments", "doc.pdf"), "%PDF-1.4\n");
  writeFileSync(join(vault, "Notes", "Deep", "local.png"), PNG);
  const root = realpathSync(vault);
  return { dir: tmp.dir, root, note, cleanup: tmp.cleanup };
}

describe("vault index", () => {
  let vault;
  let index;
  before(() => {
    vault = makeVault();
    index = createVaultIndex(vault.root);
  });
  after(() => vault.cleanup());

  test("finds a note by name, without folder or extension", () => {
    assert.equal(index.lookup("Idea"), "Notes/Idea.md");
    assert.equal(index.lookup("Deep note"), "Notes/Deep/Deep note.md");
  });

  test("finds an attachment by its file name", () => {
    assert.equal(index.lookup("pic.png"), "Attachments/pic.png");
    assert.equal(index.lookup("doc.pdf"), "Attachments/doc.pdf");
  });

  test("names are case insensitive and an explicit .md extension works", () => {
    assert.equal(index.lookup("idea"), "Notes/Idea.md");
    assert.equal(index.lookup("IDEA.MD"), "Notes/Idea.md");
    assert.equal(index.lookup("PIC.PNG"), "Attachments/pic.png");
  });

  test("a partial path disambiguates", () => {
    assert.equal(index.lookup("Alpha/Plan"), "Projects/Alpha/Plan.md");
    assert.equal(index.lookup("Beta/Plan"), "Projects/Beta/Plan.md");
    assert.equal(index.lookup("Notes/Idea"), "Notes/Idea.md");
  });

  test("among equal names the one closest to the linking document wins", () => {
    assert.equal(index.lookup("Plan", "Projects/Beta"), "Projects/Beta/Plan.md");
    assert.equal(index.lookup("Plan", "Projects/Alpha"), "Projects/Alpha/Plan.md");
    assert.equal(index.lookup("Home", "Daily"), "Daily/Home.md");
  });

  test("otherwise the shortest path wins, and the choice is stable", () => {
    assert.equal(index.lookup("Home", "Notes"), "Home.md");
    assert.equal(index.lookup("Home"), "Home.md");
    assert.equal(index.lookup("Plan", "Elsewhere"), "Projects/Alpha/Plan.md");
  });

  test("dot directories and node_modules are not indexed", () => {
    assert.equal(index.lookup("old"), null);
    assert.equal(index.lookup("readme"), null);
    assert.equal(index.lookup("app.json"), null);
  });

  test("an unknown name is not found", () => {
    assert.equal(index.lookup("Nope"), null);
    assert.equal(index.lookup("nope.png"), null);
  });

  test("a note created after the index was built is found on a miss", () => {
    let time = 0;
    const live = createVaultIndex(vault.root, { now: () => time, ttlMs: 60000, missRefreshMs: 100 });
    assert.equal(live.lookup("Fresh"), null);
    vault.note("Notes/Fresh.md");
    time = 50;
    assert.equal(live.lookup("Fresh"), null, "a miss right after a build must not rescan");
    time = 500;
    assert.equal(live.lookup("Fresh"), "Notes/Fresh.md");
  });

  test("the index is rebuilt after its time to live", () => {
    let time = 0;
    const live = createVaultIndex(vault.root, { now: () => time, ttlMs: 1000, missRefreshMs: 1e9 });
    assert.equal(live.lookup("Ttl probe"), null);
    vault.note("Notes/Ttl probe.md");
    assert.equal(live.lookup("Ttl probe"), null);
    time = 2000;
    assert.equal(live.lookup("Ttl probe"), "Notes/Ttl probe.md");
  });

  test("a vault bigger than maxFiles is truncated, not walked forever", () => {
    const small = createVaultIndex(vault.root, { maxFiles: 3 });
    small.lookup("anything");
    assert.equal(small.truncated, true);
  });

  test("directoryWithin gives the directory of a document relative to the root", () => {
    assert.equal(directoryWithin("/v", "/v"), "");
    assert.equal(directoryWithin("/v", "/v/a/b"), "a/b");
  });
});

describe("wikilinks in rendered notes", () => {
  let vault;
  let links;
  before(() => {
    vault = makeVault();
    links = {
      root: vault.root,
      docDir: join(vault.root, "Notes"),
      assetBase: "/d/me/f/",
      docLink: (path) => `/d/${path.split("/").pop().replace(/\W/g, "")}/`,
    };
  });
  after(() => vault.cleanup());

  const html = async (markdown, extra = {}) => (await render(markdown, { kroki: false, links, ...extra })).html;

  test("[[Note]] links to the preview of that note", async () => {
    assert.match(await html("[[Idea]]"), /<a href="\/d\/Ideamd\/" class="wikilink">Idea<\/a>/);
  });

  test("an alias is the link text", async () => {
    assert.match(await html("[[Idea|my alias]]"), /class="wikilink">my alias<\/a>/);
  });

  test("a heading target links to the heading and shows Note > Heading", async () => {
    assert.match(await html("[[Idea#Some Heading]]"), /href="\/d\/Ideamd\/#some-heading" class="wikilink">Idea &#x3E; Some Heading<\/a>|href="\/d\/Ideamd\/#some-heading" class="wikilink">Idea > Some Heading<\/a>/);
  });

  test("[[#Heading]] links to a heading of the same note", async () => {
    assert.match(await html("[[#Local Heading]]"), /<a href="#local-heading" class="wikilink">Local Heading<\/a>/);
  });

  test("a block reference links to the note", async () => {
    assert.match(await html("[[Idea#^abc123]]"), /href="\/d\/Ideamd\/" class="wikilink">Idea<\/a>/);
  });

  test("a note in another folder is found by name, with spaces", async () => {
    assert.match(await html("[[Deep note]]"), /href="\/d\/Deepnotemd\/"/);
  });

  test("names that exist more than once resolve next to the linking note", async () => {
    const beta = { ...links, docDir: join(vault.root, "Projects", "Beta") };
    assert.match(await html("[[Plan]]", { links: beta }), /href="\/d\/Planmd\/"/);
    // the lookup result is checked through the resolved path
    const seen = [];
    const spy = { ...beta, docLink: (path) => (seen.push(path), "/d/x/") };
    await html("[[Plan]]", { links: spy });
    assert.equal(seen[0], join(vault.root, "Projects", "Beta", "Plan.md"));
  });

  test("a missing note is shown as unresolved, without a link", async () => {
    const out = await html("[[Nope]]");
    assert.match(out, /<a class="wikilink unresolved" title="Nope: not found in the vault">Nope<\/a>/);
    assert.doesNotMatch(out, /href/);
  });

  test("![[image]] embeds the image from the attachments folder", async () => {
    assert.match(await html("![[pic.png]]"), /<img src="\/d\/me\/f\/Attachments\/pic\.png\?m=\d+" alt="pic\.png">/);
  });

  test("![[image|300]] and ![[image|300x200]] set the size, other text is the alt", async () => {
    assert.match(await html("![[pic.png|300]]"), /alt="pic\.png" width="300"/);
    assert.match(await html("![[pic.png|180x90]]"), /width="180" height="90"/);
    assert.match(await html("![[pic.png|a caption]]"), /alt="a caption"/);
  });

  test("an image next to the note is found too", async () => {
    const deep = { ...links, docDir: join(vault.root, "Notes", "Deep") };
    assert.match(await html("![[local.png]]", { links: deep }), /src="\/d\/me\/f\/Notes\/Deep\/local\.png/);
  });

  test("a missing image is shown as unresolved", async () => {
    assert.match(await html("![[gone.png]]"), /class="wikilink unresolved"/);
  });

  test("![[note]] (transclusion) is rendered as a link to the note", async () => {
    assert.match(await html("![[Idea]]"), /<a href="\/d\/Ideamd\/" class="wikilink">Idea<\/a>/);
  });

  test("a link to an attachment opens the file", async () => {
    assert.match(await html("[[doc.pdf]]"), /href="\/d\/me\/f\/Attachments\/doc\.pdf\?m=\d+" class="wikilink">doc\.pdf</);
  });

  test("code, links and other text are left alone", async () => {
    const out = await html("`[[Idea]]`\n\n```\n[[Idea]]\n```\n\n[see [[Idea]]](https://example.org)\n");
    assert.equal(out.match(/class="wikilink"/g), null);
    assert.match(out, /<code>\[\[Idea\]\]<\/code>/);
  });

  test("a note whose name contains ampersands still resolves (the ampersand math must not split it first)", async () => {
    assert.match(await html("[[Tom & Jerry]]"), /<a href="\/d\/TomJerrymd\/" class="wikilink">Tom (&#x26;|&amp;) Jerry<\/a>/);
    assert.match(await html("[[A & B & C]]"), /<a href="\/d\/ABCmd\/" class="wikilink">/);
  });

  test("a wikilink next to ordinary text and other wikilinks", async () => {
    const out = await html("see [[Idea]], [[Deep note]] and [[Nope]].");
    assert.equal(out.match(/class="wikilink/g).length, 3);
  });

  test("empty and malformed brackets stay text", async () => {
    const out = await html("[[]] [[#]] [[ ]] [[a");
    assert.equal(out.match(/class="wikilink/g), null);
  });

  test("a pipe inside a table cell needs an escape", async () => {
    const out = await html("| a | b |\n|---|---|\n| [[Idea\\|alias]] | x |\n");
    assert.match(out, /class="wikilink">alias<\/a>/);
  });

  describe("the wikilinks mode", () => {
    test("auto (the default) is on inside a vault and off elsewhere", async () => {
      assert.match(await html("[[Idea]]"), /wikilink/);
      assert.match(await html("[[Idea]]", { wikilinks: "auto" }), /wikilink/);
      const plain = tempDir("rp-plain-");
      try {
        const root = realpathSync(plain.dir);
        writeFileSync(join(root, "Idea.md"), "# Idea\n");
        const out = await html("[[Idea]]", { links: { ...links, root, docDir: root } });
        assert.doesNotMatch(out, /wikilink/);
        assert.match(out, /\[\[Idea\]\]/);
      } finally {
        plain.cleanup();
      }
    });

    test("true forces them on outside a vault", async () => {
      const plain = tempDir("rp-plain-");
      try {
        const root = realpathSync(plain.dir);
        writeFileSync(join(root, "Idea.md"), "# Idea\n");
        const out = await html("[[Idea]]", { wikilinks: true, links: { ...links, root, docDir: root } });
        assert.match(out, /class="wikilink"/);
      } finally {
        plain.cleanup();
      }
    });

    test("false turns them off inside a vault", async () => {
      assert.match(await html("[[Idea]]", { wikilinks: false }), /\[\[Idea\]\]/);
    });

    test("without a link context nothing happens", async () => {
      assert.match((await render("[[Idea]]", { kroki: false })).html, /\[\[Idea\]\]/);
    });
  });
});

describe("wikilinks in the preview server", () => {
  let vault;
  let app;
  let port;
  let cookie;
  let info;

  before(async () => {
    vault = makeVault();
    vault.note("Notes/Source.md", "# Source\n\n[[Idea]] [[Nope]]\n\n![[pic.png]]\n\n[[Idea#Some Heading]]\n");
    app = createPreviewServer({ kroki: false });
    port = await app.listen(0);
    cookie = await login(port, app.token);
    info = await app.open(join(vault.root, "Notes", "Source.md"));
  });
  after(async () => {
    await app.shutdown();
    vault.cleanup();
  });

  const get = (path) => request(port, path, { headers: { Cookie: cookie } });

  test("links open the previews of the other notes, rendered on first visit", async () => {
    const page = (await get(new URL(info.url).pathname)).body;
    const target = /<a href="(\/d\/[0-9a-f]+\/)" class="wikilink">Idea<\/a>/.exec(page);
    assert.ok(target, "the link to Idea was not rewritten");
    const idea = await get(target[1]);
    assert.equal(idea.status, 200);
    assert.match(idea.body, /<h2[^>]*id="some-heading"[^>]*>Some Heading<\/h2>/);
  });

  test("a heading link keeps its fragment", async () => {
    const page = (await get(new URL(info.url).pathname)).body;
    assert.match(page, /href="\/d\/[0-9a-f]+\/#some-heading" class="wikilink">Idea &#x3E; Some Heading|class="wikilink">Idea > Some Heading/);
  });

  test("an embedded image is served from the attachments folder", async () => {
    const page = (await get(new URL(info.url).pathname)).body;
    const src = /<img src="([^"]+)" alt="pic\.png">/.exec(page);
    assert.ok(src, "image was not embedded");
    const image = await get(src[1]);
    assert.equal(image.status, 200);
    assert.equal(image.headers["content-type"], "image/png");
  });

  test("an unresolved link has no target", async () => {
    const page = (await get(new URL(info.url).pathname)).body;
    assert.match(page, /<a class="wikilink unresolved" title="Nope: not found in the vault">Nope<\/a>/);
  });

  test("a note outside the vault root cannot be reached by a wikilink", async () => {
    const outside = join(vault.dir, "outside.md");
    writeFileSync(outside, "# Outside\n");
    const out = (await render("[[outside]]", { kroki: false, links: { root: vault.root, docDir: vault.root, assetBase: "/f/", docLink: () => "/d/x/" } })).html;
    assert.match(out, /wikilink unresolved/);
  });
});

async function launch() {
  try {
    const puppeteer = (await import("puppeteer")).default;
    return await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  } catch {
    return null;
  }
}

test("in the browser a wikilink opens the other note and the embedded image loads", { timeout: 90000 }, async (t) => {
  const browser = await launch();
  if (!browser) {
    t.skip("Chrome/puppeteer not available");
    return;
  }
  const vault = makeVault();
  vault.note("Notes/Source.md", "# Source\n\n[[Idea]] and [[Nope]]\n\n![[pic.png]]\n");
  const app = createPreviewServer({ kroki: false });
  await app.listen(0);

  try {
    const info = await app.open(join(vault.root, "Notes", "Source.md"));
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (req) => (new URL(req.url()).hostname === "127.0.0.1" ? req.continue() : req.abort()));
    await page.goto(info.url, { waitUntil: "load" });
    await page.waitForSelector("#content h1");

    assert.equal(await page.evaluate(() => document.querySelector("#content img").naturalWidth), 1, "the embedded image must load");
    assert.equal(await page.evaluate(() => document.querySelector("a.wikilink.unresolved").hasAttribute("href")), false);

    const before = await page.evaluate(() => location.pathname);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "load" }),
      page.evaluate(() => [...document.querySelectorAll("a.wikilink")].find((a) => a.textContent === "Idea").click()),
    ]);
    assert.notEqual(await page.evaluate(() => location.pathname), before);
    await page.waitForSelector("#content h1");
    assert.equal(await page.evaluate(() => document.querySelector("#content h1").textContent), "Idea");
  } finally {
    await browser.close();
    await app.shutdown();
    vault.cleanup();
  }
});
