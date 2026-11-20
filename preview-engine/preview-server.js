import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, readFileSync, realpathSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import mime from "mime-types";
import { isServableAsset } from "./links.js";
import { render } from "./pipeline.js";
import { DEFAULT_MARKERS, findRoot, hasHiddenSegment, isInside } from "./roots.js";
import { renderShell } from "./shell.js";

const engineDir = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const HEARTBEAT_MS = 15000;

const sha256 = (value) => createHash("sha256").update(value).digest();

function safeEqual(a, b) {
  return timingSafeEqual(sha256(String(a)), sha256(String(b)));
}

function parseCookies(header) {
  const cookies = {};
  for (const part of (header || "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) {
      cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
    }
  }
  return cookies;
}

// Symlinked directories are resolved so that one file has one session, whatever path it is
// reached by. The file itself is not resolved: its id must survive the file being deleted.
function canonical(path) {
  const abs = resolve(path);
  try {
    return join(realpathSync(dirname(abs)), basename(abs));
  } catch {
    return abs;
  }
}

function sessionId(path) {
  return createHash("sha1").update(canonical(path)).digest("hex").slice(0, 12);
}

/**
 * The preview server: one instance serves any number of documents, each as a
 * session reachable at /d/<id>/ and updated through Server-Sent Events.
 *
 * @param {{ theme?: string, token?: string, kroki?: { server?: string } | false, rootMarkers?: string[] }} options
 */
export function createPreviewServer(options = {}) {
  const defaultTheme = options.theme || "dark";
  const kroki = options.kroki;
  const token = options.token || randomBytes(24).toString("hex");
  const rootMarkers = options.rootMarkers || DEFAULT_MARKERS;

  /** @type {Map<string, object>} */
  const sessions = new Map();

  const staticFiles = {
    "/_/client.js": {
      type: "text/javascript; charset=utf-8",
      body: readFileSync(join(engineDir, "client", "client.js")),
    },
    "/_/sync.js": {
      type: "text/javascript; charset=utf-8",
      body: readFileSync(join(engineDir, "client", "sync.cjs")),
    },
    "/_/morphdom.js": {
      type: "text/javascript; charset=utf-8",
      body: readFileSync(require.resolve("morphdom/dist/morphdom-umd.min.js")),
    },
  };

  let port = 0;
  let heartbeat = null;

  // ------------------------------------------------------------- sessions
  function send(res, event, data, id) {
    const idLine = id === undefined ? "" : `id: ${id}\n`;
    res.write(`${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function broadcast(session, event, data, id) {
    for (const res of session.clients) {
      send(res, event, data, id);
    }
  }

  function updatePayload(session) {
    return { version: session.version, html: session.html, title: session.title, headings: session.headings };
  }

  // Where the URLs of a document may point, and how they are rewritten.
  function linksFor(session) {
    session.root = findRoot(session.path, { markers: rootMarkers });
    return {
      root: session.root,
      docDir: dirname(session.path),
      assetBase: `/d/${session.id}/f/`,
      docLink: (absolutePath) => `/d/${register(absolutePath).id}/`,
    };
  }

  // Renders the file again. Renders of one session never overlap.
  function refresh(session) {
    const run = async () => {
      let text;
      try {
        text = await readFile(session.path, "utf8");
      } catch (e) {
        return fail(session, `Cannot read ${session.path}: ${e.message}`);
      }
      try {
        const links = linksFor(session);
        const result = await render(text, { theme: session.theme, path: session.path, kroki, links });
        session.html = result.html;
        session.headings = result.headings;
        session.title = result.title || basename(session.path);
        session.version += 1;
        session.error = null;
        broadcast(session, "update", updatePayload(session), session.version);
      } catch (e) {
        return fail(session, `Render failed: ${e && e.message ? e.message : e}`);
      }
    };
    session.queue = session.queue.then(run, run);
    return session.queue;
  }

  function fail(session, message) {
    session.error = message;
    broadcast(session, "render-error", { message });
  }

  // Creates the session of a document without rendering it (that happens on the first request).
  function register(path, theme = defaultTheme) {
    const abs = canonical(path);
    const id = sessionId(abs);
    let session = sessions.get(id);
    if (!session) {
      session = {
        id,
        path: abs,
        theme,
        html: "",
        headings: [],
        title: basename(abs),
        version: 0,
        error: null,
        root: null,
        clients: new Set(),
        queue: Promise.resolve(),
      };
      sessions.set(id, session);
    }
    return session;
  }

  /** Registers a document (or re-registers it) and renders it. */
  async function open(path, openOptions = {}) {
    const theme = openOptions.theme || defaultTheme;
    const existed = sessions.has(sessionId(path));
    const session = register(path, theme);
    const themeChanged = existed && session.theme !== theme;
    session.theme = theme;
    await refresh(session);
    if (themeChanged) {
      broadcast(session, "reload", {});
    }
    return { id: session.id, path, url: sessionUrl(session.id) };
  }

  /** Re-reads the document from disk and pushes the result to its viewers. */
  async function update(path) {
    const session = sessions.get(sessionId(path));
    if (!session) {
      throw new Error(`No preview open for ${path}`);
    }
    await refresh(session);
    return session.version;
  }

  /** Tells the viewers of a document to show a source line; returns how many there are. */
  function scroll(path, line) {
    const session = sessions.get(sessionId(path));
    if (!session) {
      throw new Error(`No preview open for ${path}`);
    }
    broadcast(session, "scroll", { line });
    return session.clients.size;
  }

  function closeSession(path) {
    const id = sessionId(path);
    const session = sessions.get(id);
    if (!session) {
      return false;
    }
    broadcast(session, "closed", {});
    for (const res of session.clients) {
      res.end();
    }
    sessions.delete(id);
    return true;
  }

  function sessionUrl(id) {
    return `http://127.0.0.1:${port}/d/${id}/?t=${token}`;
  }

  // ------------------------------------------------------------- http
  const cookieName = () => `rp_token_${port}`;

  function reply(res, status, body, headers = {}) {
    res.writeHead(status, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      ...headers,
    });
    res.end(body);
  }

  function hostAllowed(req) {
    const host = req.headers.host;
    return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
  }

  async function handle(req, res) {
    // DNS rebinding protection: only our own loopback names are accepted.
    if (!hostAllowed(req)) {
      return reply(res, 403, "Forbidden: unexpected Host header");
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return reply(res, 405, "Method Not Allowed", { Allow: "GET, HEAD" });
    }

    const url = new URL(req.url, `http://127.0.0.1:${port}`);

    // First visit: the token in the URL is exchanged for a cookie.
    const queryToken = url.searchParams.get("t");
    if (queryToken !== null) {
      if (!safeEqual(queryToken, token)) {
        return reply(res, 401, "Unauthorized");
      }
      url.searchParams.delete("t");
      return reply(res, 302, "", {
        Location: url.pathname + url.search + url.hash,
        "Set-Cookie": `${cookieName()}=${token}; HttpOnly; SameSite=Strict; Path=/`,
      });
    }
    const cookie = parseCookies(req.headers.cookie)[cookieName()];
    if (cookie === undefined || !safeEqual(cookie, token)) {
      return reply(res, 401, "Unauthorized");
    }

    const asset = staticFiles[url.pathname];
    if (asset) {
      return reply(res, 200, req.method === "HEAD" ? "" : asset.body, { "Content-Type": asset.type });
    }

    const match = /^\/d\/([0-9a-f]+)(\/events|\/f\/.+|\/)?$/.exec(url.pathname);
    if (!match) {
      return reply(res, 404, "Not Found");
    }
    const session = sessions.get(match[1]);
    if (!session) {
      return reply(res, 404, "Not Found");
    }
    if (match[2] === undefined) {
      return reply(res, 301, "", { Location: `${url.pathname}/${url.search}` });
    }
    if (match[2] === "/events") {
      return serveEvents(req, res, session, url);
    }
    if (match[2].startsWith("/f/")) {
      return serveAsset(req, res, session, match[2].slice(3));
    }
    // A document reached through a link is rendered on its first visit.
    await session.queue;
    if (session.version === 0 && !session.error) {
      await refresh(session);
    }
    const page = renderShell({
      id: session.id,
      theme: session.theme,
      title: session.title,
      html: session.html,
      version: session.version,
      error: session.error,
    });
    return reply(res, 200, req.method === "HEAD" ? "" : page, { "Content-Type": "text/html; charset=utf-8" });
  }

  // Files of the project (images, media, pdf) referenced by a document.
  async function serveAsset(req, res, session, encodedPath) {
    let rel;
    try {
      rel = encodedPath.split("/").map(decodeURIComponent).join("/");
    } catch {
      return reply(res, 400, "Bad Request");
    }
    if (rel.includes("\0")) {
      return reply(res, 400, "Bad Request");
    }
    // Hidden files (.git, .env, ..), file types that are not media, and anything outside the root.
    if (hasHiddenSegment(rel) || !isServableAsset(rel)) {
      return reply(res, 403, "Forbidden");
    }
    const root = session.root || findRoot(session.path, { markers: rootMarkers });
    const lexical = resolve(root, rel);
    if (!isInside(root, lexical)) {
      return reply(res, 403, "Forbidden");
    }
    let real;
    try {
      real = realpathSync(lexical);
    } catch {
      return reply(res, 404, "Not Found");
    }
    if (!isInside(root, real) || hasHiddenSegment(relative(root, real))) {
      return reply(res, 403, "Forbidden"); // a symlink leading out of the root
    }
    let info;
    try {
      info = await stat(real);
    } catch {
      return reply(res, 404, "Not Found");
    }
    if (!info.isFile()) {
      return reply(res, 404, "Not Found");
    }

    const headers = {
      "Content-Type": mime.lookup(extname(real)) || "application/octet-stream",
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    };
    if (extname(real).toLowerCase() === ".svg") {
      headers["Content-Security-Policy"] = "sandbox"; // no scripts when an svg is opened on its own
    }

    let start = 0;
    let end = info.size - 1;
    let status = 200;
    if (req.headers.range && info.size > 0) {
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (range && (range[1] !== "" || range[2] !== "")) {
        if (range[1] === "") {
          start = Math.max(0, info.size - Number(range[2]));
        } else {
          start = Number(range[1]);
          if (range[2] !== "") {
            end = Math.min(Number(range[2]), end);
          }
        }
      }
      if (!range || start > end || start >= info.size) {
        return reply(res, 416, "Range Not Satisfiable", { "Content-Range": `bytes */${info.size}` });
      }
      status = 206;
      headers["Content-Range"] = `bytes ${start}-${end}/${info.size}`;
    }

    headers["Content-Length"] = info.size === 0 ? 0 : end - start + 1;
    res.writeHead(status, headers);
    if (req.method === "HEAD" || info.size === 0) {
      return res.end();
    }
    createReadStream(real, { start, end })
      .on("error", () => res.destroy())
      .pipe(res);
  }

  function serveEvents(req, res, session, url) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Content-Type-Options": "nosniff",
    });
    res.write("retry: 2000\n\n");
    session.clients.add(res);
    req.on("close", () => session.clients.delete(res));

    // Catch up a viewer that missed updates: the page carries the version it
    // was rendered with and, after a reconnect, the browser sends Last-Event-ID.
    const known = Number(req.headers["last-event-id"] ?? url.searchParams.get("v"));
    if (Number.isFinite(known) && known !== session.version) {
      send(res, "update", updatePayload(session), session.version);
    }
    if (session.error) {
      send(res, "render-error", { message: session.error });
    }
  }

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (res.headersSent) {
        res.destroy();
      } else {
        reply(res, 500, "Internal Server Error");
      }
    });
  });

  return {
    token,
    sessions,
    open,
    update,
    scroll,
    closeSession,
    sessionUrl,
    address: () => server.address(),

    /** Starts listening on loopback; resolves with the port. */
    listen(wantedPort = 0) {
      return new Promise((resolvePort, reject) => {
        server.once("error", reject);
        server.listen(wantedPort, "127.0.0.1", () => {
          port = server.address().port;
          heartbeat = setInterval(() => {
            for (const session of sessions.values()) {
              for (const res of session.clients) {
                res.write(": ping\n\n");
              }
            }
          }, HEARTBEAT_MS);
          heartbeat.unref();
          resolvePort(port);
        });
      });
    },

    async shutdown() {
      clearInterval(heartbeat);
      for (const session of sessions.values()) {
        for (const res of session.clients) {
          res.end();
        }
      }
      sessions.clear();
      await new Promise((done) => {
        server.close(done);
        server.closeAllConnections();
      });
    },
  };
}
