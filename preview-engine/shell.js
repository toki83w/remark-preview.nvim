import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const engineDir = dirname(fileURLToPath(import.meta.url));

const CSS_LINKS = [
  "https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css",
  "https://cdn.jsdelivr.net/npm/@catppuccin/highlightjs@1.0.1/css/catppuccin-mocha.css",
];

const FALLBACK_CSS = 'body { font-family: "Noto Sans", sans-serif; background: #ff0000; }';

const cssCache = new Map();

// Theme stylesheet followed by the shell stylesheet (sidebar, status dot, error banner).
function loadCss(theme) {
  let css = cssCache.get(theme);
  if (css === undefined) {
    const themeFile = theme === "print" ? "print.css" : "preview.css";
    try {
      css = readFileSync(join(engineDir, themeFile), "utf8");
    } catch {
      css = FALLBACK_CSS;
    }
    css += "\n" + readFileSync(join(engineDir, "client", "shell.css"), "utf8");
    cssCache.set(theme, css);
  }
  return css;
}

export function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * The live preview page. The body is a fragment produced by pipeline.js;
 * the client swaps it in place when the server pushes an update.
 *
 * @param {{ id: string, theme: string, title: string, html: string, version: number,
 *   error?: string|null, warnings?: string[], live?: boolean }} page
 *   error: the last render failed; warnings: the render worked but something is wrong (a diagram);
 *   live: false gives a plain page for printing, without the scripts, status dot and banner
 */
export function renderShell({ id, theme, title, html, version, error = null, warnings = [], live = true }) {
  const cls = escapeHtml(theme);
  // an error wins over warnings: the content shown is then the last good render
  const banner = error ? { text: error, warning: false } : { text: warnings.join("\n"), warning: true };
  const liveParts = {
    top: `<span id="rp-status" title="connecting"></span>
<div id="rp-error"${banner.text ? "" : " hidden"}${banner.warning ? ' class="warning"' : ""}>${escapeHtml(banner.text)}</div>
`,
    scripts: `<script src="/_/morphdom.js"></script>
<script src="/_/sync.js"></script>
<script src="/_/client.js" data-id="${escapeHtml(id)}" data-version="${Number(version)}"></script>
`,
  };
  const links = CSS_LINKS.map((href) => `<link rel="stylesheet" href="${href}">`).join("\n");
  return `<!doctype html>
<html lang="en" class="${cls}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${links}
<style>
${loadCss(theme)}
</style>
</head>
<body class="${cls}">
${live ? liveParts.top : ""}<div id="content">
${html}
</div>
${live ? liveParts.scripts : ""}</body>
</html>
`;
}
