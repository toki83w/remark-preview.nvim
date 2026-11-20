import { createHash } from "node:crypto";
import { getValue, parse } from "markdown-code-block-meta";
import { visit } from "unist-util-visit";

export const DEFAULT_SERVER = "https://kroki.io";
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_CACHE_ENTRIES = 200;
const TYPE_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * A least-recently-used cache. Only successful answers are ever stored in it.
 */
export function createKrokiCache(maxEntries = DEFAULT_CACHE_ENTRIES) {
  const entries = new Map();
  return {
    get(key) {
      if (!entries.has(key)) {
        return undefined;
      }
      const value = entries.get(key);
      entries.delete(key); // re-insert: most recently used goes last
      entries.set(key, value);
      return value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, value);
      while (entries.size > maxEntries) {
        entries.delete(entries.keys().next().value); // the least recently used
      }
    },
    get size() {
      return entries.size;
    },
  };
}

// Shared by every document the server renders, so a diagram is requested once.
const sharedCache = createKrokiCache();

// Diagrams being fetched right now, so identical blocks of one render share a request.
const inflight = new Map();

function failImage(message) {
  const text = String(message).replace(/[<>&"]/g, " ").slice(0, 160);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="60" viewBox="0 0 560 60">` +
      `<rect width="560" height="60" fill="#fff0f0" stroke="#d20f39"/>` +
      `<text x="12" y="25" font-family="monospace" font-size="13" fill="#d20f39">Diagram could not be rendered</text>` +
      `<text x="12" y="45" font-family="monospace" font-size="11" fill="#555">${text}</text></svg>`,
  );
}

const toDataUrl = (svg) => `data:image/svg+xml;base64,${svg.toString("base64")}`;

async function requestDiagram({ server, type, source, timeoutMs, fetchImpl }) {
  let response;
  try {
    response = await fetchImpl(`${server.replace(/\/$/, "")}/${type}/svg`, {
      method: "POST",
      body: source,
      headers: { "Content-Type": "text/plain" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new Error(`the Kroki server did not answer within ${timeoutMs / 1000}s`);
    }
    throw new Error(`cannot reach the Kroki server (${(error.cause && error.cause.code) || error.message})`);
  }
  if (!response.ok) {
    const body = (await response.text()).trim().split("\n")[0].slice(0, 200);
    throw new Error(`the Kroki server answered ${response.status}${body ? `: ${body}` : ""}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Renders diagram code blocks (mermaid, plantuml, graphviz, ... or ```kroki type=...)
 * through a Kroki server and embeds the result as an SVG data URL image.
 *
 * Successful answers are cached (least recently used); failures are not, so a transient
 * error is retried on the next render. Failures put a placeholder image in the document and
 * are reported in file.data.krokiErrors.
 *
 * @param {{ server?: string, alias?: string[], timeoutMs?: number, cache?: object, fetch?: typeof fetch }} options
 */
export default function remarkKrokiCache({
  server = DEFAULT_SERVER,
  alias = [],
  timeoutMs = DEFAULT_TIMEOUT_MS,
  cache = sharedCache,
  fetch: fetchImpl = globalThis.fetch,
} = {}) {
  async function diagram(type, source) {
    const key = createHash("sha256").update(JSON.stringify([server, type, source])).digest("hex");
    const cached = cache.get(key);
    if (cached) {
      return cached;
    }
    if (!inflight.has(key)) {
      const request = requestDiagram({ server, type, source, timeoutMs, fetchImpl })
        .then((svg) => {
          cache.set(key, svg);
          return svg;
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, request);
    }
    return inflight.get(key);
  }

  return async (tree, file) => {
    const jobs = [];
    visit(tree, "code", (node) => {
      if (!node.value || !node.value.trim()) {
        return;
      }
      const meta = parse(node.meta);
      const isKrokiBlock = node.lang === "kroki" && meta.has("type");
      if (!alias.includes(node.lang) && !isKrokiBlock) {
        return;
      }
      jobs.push({
        node,
        type: isKrokiBlock ? getValue(meta.get("type")) : node.lang,
        alt: getValue(meta.get("alt")),
      });
    });

    await Promise.all(
      jobs.map(async ({ node, type, alt }) => {
        let svg;
        try {
          if (typeof type !== "string" || !TYPE_PATTERN.test(type)) {
            throw new Error(`"${type}" is not a valid diagram type`);
          }
          svg = await diagram(type, node.value);
        } catch (error) {
          svg = failImage(error.message);
          file.data.krokiErrors = file.data.krokiErrors || [];
          file.data.krokiErrors.push({ type: String(type), message: error.message, line: node.position?.start.line });
        }

        // Same shape the remark-kroki plugin produced: a paragraph with one image whose alt is
        // the diagram type (rehype-kroki-img-bg relies on it). The source position is kept.
        const position = node.position;
        for (const key of Object.keys(node)) {
          delete node[key];
        }
        Object.assign(node, {
          type: "paragraph",
          children: [{ type: "image", _meta: { kroki: true, type }, alt: alt || type, url: toDataUrl(svg) }],
          position,
        });
      }),
    );
  };
}
