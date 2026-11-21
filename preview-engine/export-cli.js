#!/usr/bin/env node
// Exports a markdown file to PDF without Neovim.
//   node export-cli.js file.md [output.pdf]
// Environment: PDF_FORMAT (default A4), PDF_MARGIN (default 1cm), PREVIEW_KROKI_SERVER,
// PREVIEW_LOCAL_DIAGRAMS ("false": do not use merman-cli and plantuml).
import { resolve } from "node:path";
import { createPreviewServer } from "./preview-server.js";
import { krokiFromEnv } from "./pipeline.js";

const input = process.argv[2];
if (!input) {
  console.error("usage: export-cli.js file.md [output.pdf]");
  process.exit(2);
}
const path = resolve(input);
const out = resolve(process.argv[3] || path.replace(/\.[^.]*$/, "") + ".pdf");

const app = createPreviewServer({ kroki: krokiFromEnv() });
await app.listen(0);
try {
  await app.exportPdf({ path, out, format: process.env.PDF_FORMAT, margin: process.env.PDF_MARGIN });
  console.log(out);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await app.shutdown();
}
