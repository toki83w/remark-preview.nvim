#!/usr/bin/env node
// Preview server process, driven by Neovim through JSON lines.
//
// stdin  (one JSON object per line):
//   {"type":"open","path":"/abs/file.md","theme":"dark"}
//   {"type":"update","path":"/abs/file.md"}
//   {"type":"close","path":"/abs/file.md"}
//   {"type":"shutdown"}
// stdout (one JSON object per line):
//   {"type":"ready","port":1234,"token":"..."}
//   {"type":"opened","path":"/abs/file.md","id":"...","url":"http://127.0.0.1:1234/d/<id>/?t=<token>"}
//   {"type":"updated","path":"/abs/file.md","version":2}
//   {"type":"closed","path":"/abs/file.md"}
//   {"type":"error","path":"/abs/file.md","message":"..."}
// The process exits when stdin is closed (e.g. Neovim died).
import { createInterface } from "node:readline";
import { createPreviewServer } from "./preview-server.js";

const app = createPreviewServer({ theme: process.env.PREVIEW_THEME || "dark" });

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

const port = await app.listen(0);
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
