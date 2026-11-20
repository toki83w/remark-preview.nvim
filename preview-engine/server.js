#!/usr/bin/env node
// Preview server process, driven by Neovim through JSON lines.
//
// stdin  (one JSON object per line):
//   {"type":"open","path":"/abs/file.md","theme":"dark"}
//   {"type":"update","path":"/abs/file.md"}
//   {"type":"scroll","path":"/abs/file.md","line":42}
//   {"type":"close","path":"/abs/file.md"}
//   {"type":"shutdown"}
// stdout (one JSON object per line):
//   {"type":"ready","port":1234,"token":"..."}
//   {"type":"opened","path":"/abs/file.md","id":"...","url":"http://127.0.0.1:1234/d/<id>/?t=<token>"}
//   {"type":"updated","path":"/abs/file.md","version":2}
//   {"type":"scrolled","path":"/abs/file.md","viewers":1}
//   {"type":"closed","path":"/abs/file.md"}
//   {"type":"error","path":"/abs/file.md","message":"..."}
//   {"type":"fatal","message":"..."}   (startup failure, followed by exit code 1)
// Environment: PREVIEW_THEME (default "dark"), PREVIEW_PORT (default: any free port),
// PREVIEW_ROOT_MARKERS (JSON list of files/directories marking a project root, default [".obsidian", ".git"]).
// The process exits when stdin is closed (e.g. Neovim died).
import { createInterface } from "node:readline";
import { createPreviewServer } from "./preview-server.js";

function rootMarkersFromEnv() {
  try {
    const markers = JSON.parse(process.env.PREVIEW_ROOT_MARKERS || "null");
    return Array.isArray(markers) && markers.every((m) => typeof m === "string") ? markers : undefined;
  } catch {
    return undefined;
  }
}

const app = createPreviewServer({
  theme: process.env.PREVIEW_THEME || "dark",
  rootMarkers: rootMarkersFromEnv(),
});

function emit(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

async function shutdown() {
  try {
    await app.shutdown();
  } finally {
    process.exit(0);
  }
}

async function dispatch(message) {
  switch (message.type) {
    case "open": {
      const info = await app.open(message.path, { theme: message.theme });
      emit({ type: "opened", ...info });
      break;
    }
    case "update": {
      const version = await app.update(message.path);
      emit({ type: "updated", path: message.path, version });
      break;
    }
    case "scroll": {
      if (!Number.isInteger(message.line) || message.line < 1) {
        throw new Error(`Invalid line: ${message.line}`);
      }
      emit({ type: "scrolled", path: message.path, viewers: app.scroll(message.path, message.line) });
      break;
    }
    case "close":
      emit({ type: "closed", path: message.path, found: app.closeSession(message.path) });
      break;
    case "shutdown":
      await shutdown();
      break;
    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

// PREVIEW_PORT forces a port; the default 0 lets the OS pick a free one.
let port;
try {
  port = await app.listen(Number(process.env.PREVIEW_PORT) || 0);
} catch (e) {
  emit({ type: "fatal", message: `Cannot listen: ${e.message}` });
  process.exit(1);
}
emit({ type: "ready", port, token: app.token });

const lines = createInterface({ input: process.stdin });
let pending = Promise.resolve();

lines.on("line", (line) => {
  if (!line.trim()) {
    return;
  }
  // Messages are handled in order.
  pending = pending.then(async () => {
    let message;
    try {
      message = JSON.parse(line);
      await dispatch(message);
    } catch (e) {
      emit({ type: "error", path: message && message.path, message: e.message });
    }
  });
});

lines.on("close", () => {
  pending.then(shutdown);
});
