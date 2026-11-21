import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { createLocalRenderers, findExecutable, LOCAL_TOOLS, withIntrinsicSize } from "../local-diagrams.js";
import { krokiFromEnv, render } from "../pipeline.js";
import { createKrokiCache } from "../remark-kroki-cache.js";
import { tempDir } from "./helpers.js";

const KROKI_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text>from kroki</text></svg>';

// A fake command line tool: a Node script that reads stdin and behaves as FAKE_MODE says.
//   ok: answers an SVG echoing its arguments, its stdin and PLANTUML_SECURITY_PROFILE
//   fail: stderr noise and a message, exit code 1     garbage: exit 0 with something that is no SVG
//   hang: never ends                                  slow: takes 300ms, and logs when it starts and ends
const FAKE_TOOL = (execPath) => `#!${execPath}
const fs = require("node:fs");
const input = fs.readFileSync(0, "utf8");
const mode = process.env.FAKE_MODE || "ok";
const log = (what) => process.env.FAKE_LOG && fs.appendFileSync(process.env.FAKE_LOG, what + " " + Date.now() + "\\n");
log("call");
if (mode === "fail") {
  process.stderr.write("Picked up _JAVA_OPTIONS: -Dnoise\\nerror: bad diagram near line 2\\n");
  process.exit(1);
}
if (mode === "garbage") {
  process.stdout.write("this is not an image");
} else if (mode === "hang") {
  setInterval(() => {}, 1000);
} else if (mode === "slow") {
  log("start");
  setTimeout(() => {
    log("end");
    process.stdout.write("<svg xmlns='http://www.w3.org/2000/svg'></svg>");
  }, 300);
} else {
  const echo = [process.argv.slice(2).join(" "), input.trim(), process.env.PLANTUML_SECURITY_PROFILE || ""].join("|");
  process.stdout.write("<svg xmlns='http://www.w3.org/2000/svg'><desc>" + echo + "</desc></svg>");
}
`;

describe("local diagram tools", () => {
  let tmp;
  let bin;
  const env = (extra = {}) => ({ PATH: "/usr/bin:/bin", ...extra });
  const renderers = (extra = {}, options = {}) => createLocalRenderers({ path: bin, env: env(extra), ...options });
  const desc = (svg) => /<desc>(.*)<\/desc>/s.exec(svg.toString())[1];

  before(() => {
    tmp = tempDir("rp-local-");
    bin = join(tmp.dir, "bin");
    mkdirSync(bin);
    for (const name of ["merman-cli", "plantuml"]) {
      writeFileSync(join(bin, name), FAKE_TOOL(process.execPath));
      chmodSync(join(bin, name), 0o755);
    }
  });
  after(() => tmp.cleanup());

  describe("finding the tools", () => {
    test("the known tools are merman-cli for mermaid and plantuml for plantuml", () => {
      assert.deepEqual(LOCAL_TOOLS, { mermaid: "merman-cli", plantuml: "plantuml" });
    });

    test("findExecutable returns the first executable file on the path", () => {
      assert.equal(findExecutable("merman-cli", bin), join(bin, "merman-cli"));
      assert.equal(findExecutable("merman-cli", `${join(tmp.dir, "nope")}:${bin}`), join(bin, "merman-cli"));
    });

    test("a missing tool, a directory and a file that is not executable are not found", () => {
      assert.equal(findExecutable("graphviz", bin), null);
      mkdirSync(join(bin, "adir"), { recursive: true });
      assert.equal(findExecutable("adir", bin), null);
      writeFileSync(join(bin, "notexec"), "x");
      chmodSync(join(bin, "notexec"), 0o644);
      assert.equal(findExecutable("notexec", bin), null);
    });

    test("an empty path entry does not mean the current directory", () => {
      const cwd = process.cwd();
      try {
        process.chdir(bin);
        assert.equal(findExecutable("merman-cli", ""), null);
        assert.equal(findExecutable("merman-cli", ":"), null);
      } finally {
        process.chdir(cwd);
      }
    });

    test("only the tools that are installed get a renderer", () => {
      assert.deepEqual(Object.keys(renderers()).sort(), ["mermaid", "plantuml"]);
      assert.deepEqual(Object.keys(createLocalRenderers({ path: join(tmp.dir, "nothing"), env: env() })), []);
      const only = join(tmp.dir, "only-merman");
      mkdirSync(only);
      writeFileSync(join(only, "merman-cli"), FAKE_TOOL(process.execPath));
      chmodSync(join(only, "merman-cli"), 0o755);
      assert.deepEqual(Object.keys(createLocalRenderers({ path: only, env: env() })), ["mermaid"]);
    });

    test("a renderer says which executable it runs", () => {
      assert.equal(renderers().mermaid.executable, join(bin, "merman-cli"));
    });
  });

  describe("the size of the image", () => {
    const sized = (svg) => withIntrinsicSize(Buffer.from(svg)).toString();
    const root = (svg) => /<svg\b[^>]*>/.exec(sized(svg))[0];

    test('width="100%" (merman-cli) becomes the size of the viewBox, so an <img> is not 0x0', () => {
      const tag = root('<svg id="merman" width="100%" style="max-width: 187px;" viewBox="4.5 4 187 479"><g/></svg>');
      assert.match(tag, /^<svg width="187" height="479" /);
      assert.doesNotMatch(tag, /width="100%"/);
      assert.match(tag, /id="merman"/);
      assert.match(tag, /viewBox="4.5 4 187 479"/);
    });

    test("a missing size is taken from the viewBox, also with decimals and exponents", () => {
      assert.match(root('<svg viewBox="0 0 544.13 450"></svg>'), /^<svg width="544.13" height="450" /);
      assert.match(root('<svg viewBox="0 5.8e-15 600 400"></svg>'), /^<svg width="600" height="400" /);
      assert.match(root('<svg viewBox="0,0,120,80"></svg>'), /^<svg width="120" height="80" /);
    });

    test("an SVG that already has an absolute size is left alone", () => {
      for (const svg of [
        '<svg width="72px" height="108px" viewBox="0 0 72 108"></svg>',
        '<svg width="190" height="494" viewBox="4.5 4 190 494"></svg>',
        '<svg height="108px" viewBox="0 0 72 108" width="72px"></svg>',
      ]) {
        assert.equal(sized(svg), svg);
      }
    });

    test("only the root element is changed, and only when a viewBox gives a size", () => {
      const inner = '<svg width="100%" viewBox="0 0 10 10"><svg width="100%" height="50%" viewBox="0 0 1 1"/></svg>';
      assert.match(sized(inner), /^<svg width="10" height="10" viewBox="0 0 10 10"><svg width="100%" height="50%"/);
      const noBox = '<svg width="100%"></svg>';
      assert.equal(sized(noBox), noBox);
      const empty = '<svg width="100%" viewBox="0 0 0 0"></svg>';
      assert.equal(sized(empty), empty);
      assert.equal(sized("not an svg"), "not an svg");
    });

    test("a renderer gives an image with an absolute size even when the tool writes 100%", async () => {
      const percent = join(tmp.dir, "percent");
      mkdirSync(percent);
      writeFileSync(
        join(percent, "merman-cli"),
        `#!${process.execPath}\nprocess.stdin.resume();process.stdin.on("end",()=>process.stdout.write('<svg id="m" width="100%" viewBox="0 0 150 90"><g/></svg>'));\n`,
      );
      chmodSync(join(percent, "merman-cli"), 0o755);
      const svg = await createLocalRenderers({ path: percent, env: env() }).mermaid("graph TD; A-->B");
      assert.match(svg.toString(), /^<svg width="150" height="90" id="m" /);
    });
  });

  describe("running them", () => {
    test("the source goes in on stdin and the SVG comes out", async () => {
      const svg = await renderers().mermaid("graph TD; A-->B\n");
      assert.match(svg.toString(), /^<svg /);
      const [args, input] = desc(svg).split("|");
      assert.equal(args, "render - -o - -f svg -q -t default");
      assert.equal(input, "graph TD; A-->B");
    });

    test("plantuml reads stdin as UTF-8 and writes an SVG", async () => {
      const [args] = desc(await renderers().plantuml("@startuml\nA -> B\n@enduml")).split("|");
      assert.equal(args, "-charset UTF-8 -pipe -tsvg");
    });

    test("plantuml runs in the SANDBOX profile, so a document cannot !include the user's files", async () => {
      // even when the environment asks for the opposite
      const out = desc(await renderers({ PLANTUML_SECURITY_PROFILE: "LEGACY" }).plantuml("@startuml\n@enduml"));
      assert.equal(out.split("|")[2], "SANDBOX");
    });

    test("the other tools are left with the environment as it is", async () => {
      const out = desc(await renderers({ PLANTUML_SECURITY_PROFILE: "x" }).mermaid("graph TD; A-->B"));
      assert.equal(out.split("|")[2], "x");
    });

    test("the print look: merman-cli gets the editor-light preset, plantuml is unchanged", async () => {
      const mermaid = await renderers().mermaid("graph TD; A-->B", { print: true });
      assert.equal(desc(mermaid).split("|")[0], "render - -o - -f svg -q --theme-preset editor-light");
      const screen = await renderers().mermaid("graph TD; A-->B");
      assert.equal(desc(screen).split("|")[0], "render - -o - -f svg -q -t default", "the screen look is the default");
      const plantuml = await renderers().plantuml("@startuml\nA -> B\n@enduml", { print: true });
      assert.equal(desc(plantuml).split("|")[0], "-charset UTF-8 -pipe -tsvg");
    });

    test("a failure is reported with the tool name and its message, without JVM noise", async () => {
      await assert.rejects(renderers({ FAKE_MODE: "fail" }).mermaid("graph"), {
        message: "merman-cli: bad diagram near line 2",
      });
    });

    test("output that is not an SVG is refused, even with exit code 0", async () => {
      await assert.rejects(renderers({ FAKE_MODE: "garbage" }).plantuml("x"), /plantuml: did not produce an SVG image/);
    });

    test("a tool that does not finish is killed after the timeout", async () => {
      const started = Date.now();
      await assert.rejects(renderers({ FAKE_MODE: "hang" }, { timeoutMs: 200 }).mermaid("x"), {
        message: "merman-cli: did not finish within 0.2s",
      });
      assert.ok(Date.now() - started < 5000, "the hanging process must be killed, not waited for");
    });

    test("a tool that cannot be started is a readable failure", async () => {
      const broken = join(tmp.dir, "broken");
      mkdirSync(broken);
      writeFileSync(join(broken, "merman-cli"), "#!/nonexistent/interpreter\n");
      chmodSync(join(broken, "merman-cli"), 0o755);
      await assert.rejects(createLocalRenderers({ path: broken, env: env() }).mermaid("x"), /^Error: merman-cli: /);
    });

    test("at most two plantuml processes run at once, the others wait", async () => {
      const log = join(tmp.dir, "concurrency.log");
      writeFileSync(log, "");
      const plantuml = renderers({ FAKE_MODE: "slow", FAKE_LOG: log }).plantuml;
      await Promise.all(Array.from({ length: 6 }, (_, i) => plantuml(`@startuml\nA -> B: ${i}\n@enduml`)));
      let running = 0;
      let peak = 0;
      for (const line of readFileSync(log, "utf8").trim().split("\n")) {
        const [what] = line.split(" ");
        if (what === "start") peak = Math.max(peak, ++running);
        if (what === "end") running--;
      }
      assert.equal(peak, 2);
    });
  });

  describe("in a document", () => {
    let calls;
    const fetchImpl = async (url) => {
      calls.push(url);
      return new Response(KROKI_SVG, { status: 200 });
    };
    // the options object is the key of the processor cache: one per scenario, reused between renders
    const options = (local, extra = {}) => ({
      kroki: { local, fetch: fetchImpl, cache: createKrokiCache(), server: "http://kroki.test", ...extra },
    });
    const block = (lang, source) => "```" + lang + "\n" + source + "\n```\n";
    const svgs = (html) =>
      [...html.matchAll(/src="data:image\/svg\+xml;base64,([^"]+)"/g)].map((m) => Buffer.from(m[1], "base64").toString());

    test("a mermaid diagram is drawn by the tool and never sent to Kroki", async () => {
      calls = [];
      const { html, warnings } = await render(block("mermaid", "graph TD; A-->B"), options(renderers()));
      assert.match(svgs(html)[0], /<desc>render - -o - -f svg -q -t default\|graph TD; A-->B\|<\/desc>/);
      assert.deepEqual(warnings, []);
      assert.deepEqual(calls, []);
    });

    test("the types without a local tool still go to Kroki", async () => {
      calls = [];
      const { html } = await render(
        block("mermaid", "graph TD; A-->B") + "\n" + block("graphviz", "digraph G {a->b}"),
        options(renderers()),
      );
      assert.deepEqual(calls, ["http://kroki.test/graphviz/svg"]);
      assert.match(svgs(html)[1], /from kroki/);
    });

    test("a ```kroki type=mermaid block is drawn locally too", async () => {
      calls = [];
      const { html } = await render(block("kroki type=mermaid", "graph TD; A-->B"), options(renderers()));
      assert.match(svgs(html)[0], /<desc>/);
      assert.deepEqual(calls, []);
    });

    test("when the tool is missing, Kroki draws the diagram", async () => {
      calls = [];
      const none = createLocalRenderers({ path: join(tmp.dir, "nothing"), env: env() });
      const { html } = await render(block("mermaid", "graph TD; A-->B"), options(none));
      assert.deepEqual(calls, ["http://kroki.test/mermaid/svg"]);
      assert.match(svgs(html)[0], /from kroki/);
    });

    test("a tool that fails is a warning and a placeholder: the source is not sent to Kroki", async () => {
      calls = [];
      const { html, warnings } = await render(block("mermaid", "graph TD; A-->"), options(renderers({ FAKE_MODE: "fail" })));
      assert.deepEqual(calls, [], "falling back would send the source away");
      assert.match(svgs(html)[0], /Diagram could not be rendered/);
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /Diagram "mermaid" \(line 1\): merman-cli: bad diagram near line 2/);
    });

    test("a failure is not cached: the next render runs the tool again", async () => {
      const log = join(tmp.dir, "cache.log");
      writeFileSync(log, "");
      const opts = options(renderers({ FAKE_MODE: "fail", FAKE_LOG: log }));
      await render(block("mermaid", "graph TD; A-->"), opts);
      await render(block("mermaid", "graph TD; A-->"), opts);
      assert.equal(readFileSync(log, "utf8").trim().split("\n").length, 2);
    });

    test("an identical diagram is drawn once, then served from the cache", async () => {
      const log = join(tmp.dir, "hits.log");
      writeFileSync(log, "");
      const opts = options(renderers({ FAKE_LOG: log }));
      await render(block("mermaid", "graph TD; A-->B"), opts);
      await render(block("mermaid", "graph TD; A-->B"), opts);
      await render(block("mermaid", "graph TD; A-->B") + block("mermaid", "graph TD; A-->B"), opts);
      assert.equal(readFileSync(log, "utf8").trim().split("\n").length, 1);
    });

    test("a diagram drawn by Kroki is not reused for the local tool, and the other way round", async () => {
      calls = [];
      const cache = createKrokiCache();
      const none = createLocalRenderers({ path: join(tmp.dir, "nothing"), env: env() });
      const viaKroki = await render(block("mermaid", "graph TD; A-->B"), options(none, { cache }));
      const local = await render(block("mermaid", "graph TD; A-->B"), options(renderers(), { cache }));
      assert.match(svgs(viaKroki.html)[0], /from kroki/);
      assert.doesNotMatch(svgs(local.html)[0], /from kroki/);
    });

    test("the print theme draws with the print look, and never shares a cached diagram with the screen", async () => {
      const log = join(tmp.dir, "print.log");
      writeFileSync(log, "");
      const cache = createKrokiCache();
      const opts = options(renderers({ FAKE_LOG: log }), { cache });
      const source = block("mermaid", "graph TD; A-->B");
      const screen = await render(source, opts);
      const print = await render(source, { ...opts, theme: "print" });
      const again = await render(source, opts);
      assert.match(svgs(screen.html)[0], /<desc>render - -o - -f svg -q -t default\|/);
      assert.match(svgs(print.html)[0], /<desc>render - -o - -f svg -q --theme-preset editor-light\|/);
      assert.match(svgs(again.html)[0], /-t default/, "a print render must not leak into the screen page");
      assert.equal(readFileSync(log, "utf8").trim().split("\n").length, 2, "one run per look; the third render is cached");
    });

    test("a diagram drawn by Kroki is the same on screen and in print", async () => {
      calls = [];
      const none = createLocalRenderers({ path: join(tmp.dir, "nothing"), env: env() });
      const opts = options(none);
      await render(block("mermaid", "graph TD; A-->B"), opts);
      await render(block("mermaid", "graph TD; A-->B"), { ...opts, theme: "print" });
      assert.deepEqual(calls, ["http://kroki.test/mermaid/svg"], "the print render reuses the cached Kroki diagram");
    });

    test("the diagram still sits in its frame", async () => {
      const { html } = await render(block("plantuml", "@startuml\nA -> B\n@enduml"), options(renderers()));
      assert.match(html, /<span class="rp-diagram" /);
      assert.match(html, /data-kroki="plantuml"/);
    });
  });

  describe("krokiFromEnv", () => {
    const withPath = async (value, run) => {
      const original = process.env.PATH;
      process.env.PATH = value;
      try {
        return await run();
      } finally {
        process.env.PATH = original;
      }
    };

    test("it finds the tools on the PATH by default", () =>
      withPath(bin, () => {
        assert.deepEqual(Object.keys(krokiFromEnv({}).local).sort(), ["mermaid", "plantuml"]);
      }));

    test("PREVIEW_LOCAL_DIAGRAMS=false turns them off", () =>
      withPath(bin, () => {
        assert.equal(krokiFromEnv({ PREVIEW_LOCAL_DIAGRAMS: "false" }), undefined);
        const options = krokiFromEnv({ PREVIEW_LOCAL_DIAGRAMS: "false", PREVIEW_KROKI_SERVER: "http://k.test" });
        assert.deepEqual(options, { server: "http://k.test" });
      }));

    test("with no tool installed there is nothing local, only the server", () =>
      withPath(join(tmp.dir, "nothing"), () => {
        assert.equal(krokiFromEnv({}), undefined);
        assert.deepEqual(krokiFromEnv({ PREVIEW_KROKI_SERVER: "http://k.test" }), { server: "http://k.test" });
      }));

    test("the server and the tools go together", () =>
      withPath(bin, () => {
        const options = krokiFromEnv({ PREVIEW_KROKI_SERVER: "http://k.test" });
        assert.equal(options.server, "http://k.test");
        assert.ok(options.local.mermaid);
      }));
  });
});

// The real tools, when this machine has them.
describe("the real merman-cli and plantuml", () => {
  const real = createLocalRenderers();

  test("merman-cli draws a mermaid flowchart and refuses a broken one", { skip: !real.mermaid && "merman-cli is not installed" }, async () => {
    const svg = (await real.mermaid("graph TD; A[Edit]-->B[Save]")).toString();
    assert.match(svg, /^<svg /);
    assert.match(svg, /Edit/);
    await assert.rejects(real.mermaid("graph TD\n  A --> \n  B[unclosed\n"), /^Error: merman-cli: /);
  });

  test("merman-cli draws with Mermaid's default theme, the one a Kroki server uses", { skip: !real.mermaid && "merman-cli is not installed" }, async () => {
    const svg = (await real.mermaid("graph TD; A[Edit]-->B[Save]")).toString();
    assert.match(svg, /fill:#ECECFF;stroke:#9370DB/i, "the default theme's lilac fill and purple border");
    assert.match(svg, /trebuchet ms/, "the default theme's font");
  });

  test("merman-cli draws the print look with the editor-light preset", { skip: !real.mermaid && "merman-cli is not installed" }, async () => {
    const svg = (await real.mermaid("graph TD; A[Edit]-->B[Save]", { print: true })).toString();
    assert.match(svg, /^<svg width="\d+" height="\d+"/, "it still has an absolute size");
    assert.doesNotMatch(svg, /fill:#ECECFF/i, "not the screen theme's lilac");
    assert.match(svg, /Inter/, "the preset's font");
    assert.match(svg, /Edit/);
  });

  test("merman-cli does not embed files, run scripts or touch the network for a document", { skip: !real.mermaid && "merman-cli is not installed" }, async () => {
    const tmp = tempDir("rp-merman-");
    try {
      const secret = join(tmp.dir, "secret.png");
      writeFileSync(secret, "TOP_SECRET_PNG_BYTES");
      const hostile = [
        `%%{init: {"securityLevel":"loose"}}%%`,
        "graph TD",
        `  A["<img src='file://${secret}' width=40> <script>alert(1)</script><b onclick=x>b</b>"] --> B`,
        '  C["<a href=\'javascript:alert(1)\'>x</a>"] --> B',
      ].join("\n");
      const svg = (await real.mermaid(hostile)).toString();
      assert.doesNotMatch(svg, /TOP_SECRET|VE9QX1NFQ1JFVF9QTkdfQllURVM/, "a local file must not end up in the image");
      assert.doesNotMatch(svg, /<script|onclick=|javascript:/i, "scripts and handlers must be removed");
      assert.doesNotMatch(svg, /src="file:/i, "a file:// source must not be kept");
    } finally {
      tmp.cleanup();
    }
  });

  test("plantuml draws a diagram, with non-ASCII text, and reports a syntax error", { skip: !real.plantuml && "plantuml is not installed" }, async () => {
    const svg = (await real.plantuml("@startuml\nAlice -> Bob: héllo\n@enduml")).toString();
    assert.match(svg, /<svg /);
    assert.match(svg, /h&#233;llo|héllo/);
    await assert.rejects(real.plantuml("@startuml\nthis is @@ not valid {{\nfoo bar baz\n@enduml"), /^Error: plantuml: /);
  });

  test("plantuml cannot !include a file of the user", { skip: !real.plantuml && "plantuml is not installed" }, async () => {
    const tmp = tempDir("rp-include-");
    try {
      const secret = join(tmp.dir, "secret.txt");
      writeFileSync(secret, "TOP_SECRET_LINE\n");
      const attempt = real.plantuml(`@startuml\n!include ${secret}\nA -> B\n@enduml`);
      const leaked = await attempt.then((svg) => svg.toString().includes("TOP_SECRET_LINE"), () => false);
      assert.equal(leaked, false);
    } finally {
      tmp.cleanup();
    }
  });
});
