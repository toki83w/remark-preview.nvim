#!/usr/bin/env node
// Renders a markdown file to an HTML fragment on stdout.
//   node render-cli.js [--theme dark|light|github-dark|github-light|print] [--no-kroki] file.md
// Environment: PREVIEW_KROKI_SERVER, PREVIEW_LOCAL_DIAGRAMS ("false": do not use merman-cli and plantuml).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { krokiFromEnv, render } from "./pipeline.js";

const args = process.argv.slice(2);
let theme = "dark";
let kroki = krokiFromEnv() ?? {};
let input = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--theme") {
    theme = args[++i];
  } else if (args[i] === "--no-kroki") {
    kroki = false;
  } else {
    input = args[i];
  }
}

if (!input) {
  console.error("usage: render-cli.js [--theme dark|light|github-dark|github-light|print] [--no-kroki] file.md");
  process.exit(2);
}

try {
  const path = resolve(input);
  const result = await render(readFileSync(path, "utf8"), { theme, kroki, path });
  process.stdout.write(result.html + "\n");
} catch (e) {
  console.error(e);
  process.exit(1);
}
