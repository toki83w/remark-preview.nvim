import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const engineDir = dirname(fileURLToPath(import.meta.url));

const HLJS_STYLES = "https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles";

// The themes of the screen preview, which the page can switch between (see the theme menu in client.js).
export const SCREEN_THEMES = ["dark", "light", "github-dark", "github-light"];

const isGithub = (theme) => theme === "github-light" || theme === "github-dark";

function cssLinks(theme) {
  const highlight = isGithub(theme)
    ? `${HLJS_STYLES}/${theme === "github-dark" ? "github-dark" : "github"}.min.css`
    : "https://cdn.jsdelivr.net/npm/@catppuccin/highlightjs@1.0.1/css/catppuccin-mocha.css";
  return ["https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css", highlight];
}

const FALLBACK_CSS = 'body { font-family: "Noto Sans", sans-serif; background: #ff0000; }';

const cssCache = new Map();

// Theme stylesheet followed by the shell stylesheet (sidebar, status dot, error banner).
function loadCss(theme) {
  let css = cssCache.get(theme);
  if (css === undefined) {
    // @import rules must come first, so the github variant file leads and the shared rules follow
    const themeFiles = isGithub(theme)
      ? [`${theme}.css`, "github.css"]
      : [theme === "print" ? "print.css" : "preview.css"];
    try {
      css = themeFiles.map((file) => readFileSync(join(engineDir, file), "utf8")).join("\n");
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
  const links = cssLinks(theme).map((href) => `<link rel="stylesheet" href="${href}">`).join("\n");
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
${live ? liveParts.top : ""}<div id="content"${isGithub(theme) ? ' class="markdown-body"' : ""}>
${html}
</div>
${live ? liveParts.scripts : ""}</body>
</html>
`;
}
