import assert from "node:assert/strict";
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { createResolver, encodePath } from "../links.js";
import { findRoot, hasHiddenSegment, isInside } from "../roots.js";
import { makeProject, tempDir } from "./helpers.js";

describe("isInside / hasHiddenSegment", () => {
  test("isInside compares path segments, not string prefixes", () => {
    assert.ok(isInside("/a/b", "/a/b"));
    assert.ok(isInside("/a/b", "/a/b/c/d"));
    assert.ok(!isInside("/a/b", "/a/bc"));
    assert.ok(!isInside("/a/b", "/a"));
    assert.ok(!isInside("/a/b", "/a/b/../c"));
  });

  test("hasHiddenSegment finds dot segments anywhere", () => {
    assert.ok(hasHiddenSegment(".env"));
    assert.ok(hasHiddenSegment("a/.git/config"));
    assert.ok(hasHiddenSegment("a/../b"));
    assert.ok(!hasHiddenSegment("a/b.c/d.png"));
  });
});

describe("findRoot", () => {
  const tmp = tempDir("rp-root-");
  const make = (...parts) => mkdirSync(join(tmp.dir, ...parts), { recursive: true });
  after(() => tmp.cleanup());

  test("is the nearest ancestor with a marker", () => {
    make("repo", ".git");
    make("repo", "docs", "deep");
    const root = findRoot(join(tmp.dir, "repo", "docs", "deep", "x.md"), { home: "/nonexistent-home" });
    assert.equal(root, join(realpathSync(tmp.dir), "repo"));
  });

  test("an .obsidian vault is a root too, and the nearest marker wins", () => {
    make("vault", ".obsidian");
    make("vault", "project", ".git");
    make("vault", "project", "src");
    const home = "/nonexistent-home";
    assert.ok(findRoot(join(tmp.dir, "vault", "note.md"), { home }).endsWith("/vault"));
    assert.ok(findRoot(join(tmp.dir, "vault", "project", "src", "r.md"), { home }).endsWith("/vault/project"));
  });

  test("falls back to the document directory without a marker", () => {
    make("plain", "sub");
    const root = findRoot(join(tmp.dir, "plain", "sub", "x.md"), { home: "/nonexistent-home" });
    assert.ok(root.endsWith("/plain/sub"));
  });

  test("markers are configurable", () => {
    make("custom", ".root");
    make("custom", "a");
    assert.ok(findRoot(join(tmp.dir, "custom", "a", "x.md"), { markers: [".root"], home: "/x" }).endsWith("/custom"));
  });

  test("the home directory is never a root, even with a .git inside", () => {
    make("home", ".git");
    make("home", "notes");
    const home = join(tmp.dir, "home");
    const root = findRoot(join(home, "notes", "x.md"), { home });
    assert.ok(root.endsWith("/home/notes"), root);
  });

  test("symlinks in the result are resolved", () => {
    make("real", ".git");
    symlinkSync(join(tmp.dir, "real"), join(tmp.dir, "link"));
    const viaLink = findRoot(join(tmp.dir, "link", "x.md"), { home: "/x" });
    assert.ok(viaLink.endsWith("/real"), viaLink);
  });
});

describe("createResolver", () => {
  let project;
  let resolver;
  const docLinks = [];

  before(() => {
    project = makeProject();
    resolver = createResolver({
      root: project.proj,
      docDir: join(project.proj, "docs"),
      assetBase: "/d/abc/f/",
      docLink: (absolute) => {
        docLinks.push(absolute);
        return "/d/other/";
      },
    });
  });
  after(() => project.cleanup());

  const kind = (url, options) => resolver.resolve(url, options).kind;

  test("leaves anchors, external and special URLs alone", () => {
    for (const url of ["#title", "", "https://x.org/a.png", "http://x", "//cdn.x/a.png", "mailto:a@b.c", "data:image/png;base64,AAAA", "tel:1"]) {
      assert.equal(kind(url), "keep", url);
    }
  });

  test("an image next to the document goes through the asset route", () => {
    const result = resolver.resolve("img/pic.png");
    assert.equal(result.kind, "asset");
    assert.match(result.url, /^\/d\/abc\/f\/docs\/img\/pic\.png\?m=\d+$/);
  });

  test("an image in a sibling directory of the document (still inside the root) is served", () => {
    const result = resolver.resolve("../assets/shared.png");
    assert.equal(result.kind, "asset");
    assert.match(result.url, /^\/d\/abc\/f\/assets\/shared\.png/);
  });

  test("a leading slash means relative to the project root", () => {
    assert.match(resolver.resolve("/assets/shared.png").url, /^\/d\/abc\/f\/assets\/shared\.png/);
  });

  test("an absolute file system path works when it is inside the root", () => {
    assert.equal(kind(join(project.proj, "assets", "shared.png")), "asset");
  });

  test("percent-encoded names are decoded and re-encoded", () => {
    const result = resolver.resolve("img/my%20pic.png");
    assert.equal(result.kind, "asset");
    assert.match(result.url, /^\/d\/abc\/f\/docs\/img\/my%20pic\.png/);
  });

  test("query strings are dropped and fragments kept", () => {
    const result = resolver.resolve("img/pic.png?raw=true#frag");
    assert.match(result.url, /\?m=\d+#frag$/);
  });

  test("paths leading out of the root are blocked", () => {
    assert.equal(kind("../../outside/secret.png"), "blocked");
    assert.equal(kind("../../../../../../etc/passwd"), "blocked");
    assert.equal(kind("/etc/passwd"), "blocked");
  });

  test("a symlink pointing out of the root is blocked", () => {
    assert.equal(kind("escape.png"), "blocked");
  });

  test("hidden files and directories are blocked", () => {
    assert.equal(kind("../.env"), "blocked");
    assert.equal(kind("../.hidden/x.png"), "blocked");
    assert.equal(kind("../.git/config"), "blocked");
  });

  test("file types that are not media are blocked, directories too", () => {
    assert.equal(kind("notes.txt"), "blocked");
    assert.equal(kind("img"), "blocked");
    assert.equal(kind("other.md"), "blocked"); // an image may not be a markdown file
  });

  test("a missing file is reported as missing, not served", () => {
    assert.equal(kind("img/nope.png"), "missing");
  });

  test("links to other markdown files become previews with their fragment", () => {
    const result = resolver.resolve("other.md#some-heading", { link: true });
    assert.deepEqual(result, { kind: "doc", url: "/d/other/#some-heading" });
    assert.equal(docLinks.at(-1), join(project.proj, "docs", "other.md"));
  });

  test("a markdown file outside the root cannot be linked", () => {
    writeFileSync(join(project.dir, "outside", "o.md"), "# o\n");
    assert.equal(kind("../../outside/o.md", { link: true }), "blocked");
  });

  test("encodePath encodes each segment", () => {
    assert.equal(encodePath("a b/c#d/é.png"), "a%20b/c%23d/%C3%A9.png");
  });
});
