import { spawn } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";

// Draws diagrams with command line tools installed on this machine, so that the source of the
// document does not have to leave it (and no internet is needed). Only the tools below are
// known; anything else is left to Kroki.

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
const MAX_STDERR_CHARS = 4000;

/**
 * diagram type -> the tool drawing it. The tool reads the diagram on stdin, writes an SVG on stdout
 * and fails with a non-zero exit code (merman-cli: 1, plantuml: 200 for a syntax error).
 * concurrency: how many run at once (PlantUML starts a JVM each).
 * env: forced on top of the environment. PlantUML can !include any file it can read, so the document
 * must not be allowed to read the user's files: SANDBOX switches that off (the stdlib still works).
 * merman-cli needs no such setting: it drops file:// image sources, strips scripts and event handlers,
 * and loads icon packs from the network only with --allow-network, which is never passed.
 */
const TOOLS = {
  // -t default: Mermaid's own default theme, which is what a Kroki server draws; without it merman-cli
  // uses its own black-outline style, and a document would look different depending on who drew it.
  // printArgs: for the print theme (PDF export) the editor-light preset is used instead. It must not be
  // combined with -t: an explicit Mermaid theme overrides the preset's colours.
  mermaid: {
    command: "merman-cli",
    args: ["render", "-", "-o", "-", "-f", "svg", "-q", "-t", "default"],
    printArgs: ["render", "-", "-o", "-", "-f", "svg", "-q", "--theme-preset", "editor-light"],
    concurrency: 4,
    env: {},
  },
  plantuml: {
    command: "plantuml",
    args: ["-charset", "UTF-8", "-pipe", "-tsvg"],
    concurrency: 2,
    env: { PLANTUML_SECURITY_PROFILE: "SANDBOX" },
  },
};

/** The diagram types that can be drawn locally, and the command each one needs. */
export const LOCAL_TOOLS = Object.fromEntries(Object.entries(TOOLS).map(([type, tool]) => [type, tool.command]));

/**
 * The first executable file called `name` in the directories of `pathVar`, or null. Empty entries
 * (meaning "the current directory") are skipped: a document's directory must never supply the tool.
 */
export function findExecutable(name, pathVar = process.env.PATH || "") {
  for (const dir of pathVar.split(delimiter)) {
    if (!dir) {
      continue;
    }
    const candidate = join(dir, name);
    try {
      if (statSync(candidate).isFile()) {
        accessSync(candidate, constants.X_OK);
        return candidate;
      }
    } catch {
      // not here, or not executable: keep looking
    }
  }
  return null;
}

// Runs at most `max` tasks at once; the others wait their turn.
function createLimiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    while (active < max && queue.length > 0) {
      active++;
      queue.shift()();
    }
  };
  return (task) =>
    new Promise((resolve, reject) => {
      queue.push(() =>
        Promise.resolve()
          .then(task)
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          }),
      );
      next();
    });
}

// Runs a command with `input` on stdin. Resolves with { code, stdout, stderr }; rejects when the
// command cannot be started, takes longer than timeoutMs or writes too much.
function run(command, args, { input, env, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    const chunks = [];
    let bytes = 0;
    let stderr = "";
    let settled = false;
    let problem = null;

    const finish = (settle, value) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        settle(value);
      }
    };
    const timer = setTimeout(() => {
      problem = `did not finish within ${timeoutMs / 1000}s`;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT_BYTES) {
        problem = "wrote too much output";
        child.kill("SIGKILL");
      } else {
        chunks.push(chunk);
      }
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < MAX_STDERR_CHARS) {
        stderr += chunk;
      }
    });
    child.on("error", (error) => finish(reject, new Error(`cannot be started (${error.code || error.message})`)));
    child.on("close", (code) => {
      if (problem) {
        finish(reject, new Error(problem));
      } else {
        finish(resolve, { code, stdout: Buffer.concat(chunks), stderr });
      }
    });
    child.stdin.on("error", () => {}); // the tool may exit before reading everything
    child.stdin.end(input);
  });
}

// What a tool said on stderr, without the noise the JVM adds ("Picked up _JAVA_OPTIONS: ...").
function messageFrom(stderr) {
  return stderr
    .split("\n")
    .map((line) => line.trim().replace(/^error:\s*/i, ""))
    .filter((line) => line && !line.startsWith("Picked up "))
    .slice(0, 3)
    .join(" ")
    .slice(0, 200);
}

// A tool that fails in a way its exit code does not show must not put garbage in the page.
function assertSvg(buffer) {
  const text = buffer.toString("utf8");
  const start = /^\s*(<\?xml[\s\S]*?\?>\s*)?(<!DOCTYPE[\s\S]*?>\s*)?<svg[\s>]/i;
  if (!start.test(text.slice(0, 1000)) || !/<\/svg>\s*$/i.test(text.slice(-100))) {
    throw new Error("did not produce an SVG image");
  }
}

const NUMBER = "[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?";
const VIEW_BOX = new RegExp(`\\sviewBox="\\s*${NUMBER}[\\s,]+${NUMBER}[\\s,]+(${NUMBER})[\\s,]+(${NUMBER})\\s*"`);
const ABSOLUTE_SIZE = (name) => new RegExp(`\\s${name}="\\s*${NUMBER}(?:px)?\\s*"`);

/**
 * The page shows a diagram as an <img>, which needs an intrinsic size. merman-cli writes
 * width="100%" (with a max-width style): in an image that has no width to be a percentage of, so
 * the diagram collapses to nothing. Gives the root <svg> the size of its viewBox when its own
 * width or height is missing or relative; an SVG that already has an absolute size is untouched.
 */
export function withIntrinsicSize(buffer) {
  const text = buffer.toString("utf8");
  const root = /<svg\b[^>]*>/i.exec(text);
  if (!root) {
    return buffer;
  }
  const tag = root[0];
  const box = VIEW_BOX.exec(tag);
  if (!box || (ABSOLUTE_SIZE("width").test(tag) && ABSOLUTE_SIZE("height").test(tag))) {
    return buffer;
  }
  const [width, height] = [Number(box[1]), Number(box[2])];
  if (!(width > 0 && height > 0)) {
    return buffer;
  }
  const sized = tag.replace(/\s(?:width|height)="[^"]*"/gi, "").replace(/^<svg/i, `<svg width="${width}" height="${height}"`);
  return Buffer.from(text.slice(0, root.index) + sized + text.slice(root.index + tag.length), "utf8");
}

/**
 * The renderers of the tools found on the PATH: { mermaid?: render, plantuml?: render }, each
 * `async (source) => Buffer` (an SVG) that rejects with a readable message, prefixed by the tool name.
 *
 * @param {{ path?: string, env?: object, timeoutMs?: number }} options
 */
export function createLocalRenderers({ path = process.env.PATH, env = process.env, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const renderers = {};
  for (const [type, tool] of Object.entries(TOOLS)) {
    const executable = findExecutable(tool.command, path);
    if (!executable) {
      continue;
    }
    const limit = createLimiter(tool.concurrency);
    // print: draw for paper (the PDF export), with the tool's print arguments when it has any
    const render = (source, { print = false } = {}) =>
      limit(async () => {
        try {
          const args = print && tool.printArgs ? tool.printArgs : tool.args;
          const result = await run(executable, args, { input: source, env: { ...env, ...tool.env }, timeoutMs });
          if (result.code !== 0) {
            throw new Error(messageFrom(result.stderr) || `exited with code ${result.code}`);
          }
          assertSvg(result.stdout);
          return withIntrinsicSize(result.stdout);
        } catch (error) {
          throw new Error(`${tool.command}: ${error.message}`);
        }
      });
    render.executable = executable;
    renderers[type] = render;
  }
  return renderers;
}
