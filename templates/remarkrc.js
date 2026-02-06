import { readFileSync } from "node:fs";
import { join } from "node:path";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkGithubAlerts from "remark-github-alerts";
import remarkMath from "remark-math";
import remarkAsciimath from "remark-asciimath";
import remarkKroki from "remark-kroki";
import remarkFlexibleToc from "remark-flexible-toc";
import remarkRehype from "remark-rehype";
import rehypeSlug from "rehype-slug";
import rehypeKatex from "rehype-katex";
import rehypeDocument from "rehype-document";
import rehypeStringify from "rehype-stringify";

const templateDir = process.env.PLUGIN_PATH;
const docDir = process.env.DOC_DIR;

// Theme Selection logic
let themeFile = "dark.css";
if (process.env.PREVIEW_THEME === "light") themeFile = "light.css";
if (process.env.PREVIEW_THEME === "print") themeFile = "print.css";

let cssContent = "";
try {
  cssContent = readFileSync(join(templateDir, themeFile), "utf8");
} catch (e) {
  cssContent = "body { background: white; color: black; }";
}

export default {
  plugins: [
    remarkParse,
    remarkGfm,
    remarkGithubAlerts,
    remarkMath,
    remarkAsciimath,
    [remarkKroki, { server: "https://kroki.io", output: "inline-svg" }],
    // Recognizes [toc] and builds the list
    [
      remarkFlexibleToc,
      {
        placeholder: "[toc]",
        containerTag: "nav",
        containerClassName: "table-of-contents",
      },
    ],
    [remarkRehype, { allowDangerousHtml: true }],
    rehypeSlug, // Generates <h2 id="my-heading"> for the TOC to link to
    rehypeKatex,
    [
      rehypeDocument,
      {
        head: [
          {
            type: "element",
            tagName: "base",
            properties: { href: "file://" + docDir + "/" },
          },
        ],
        css: ["https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css"],
        style:
          cssContent +
          `
            html { scroll-behavior: smooth; }
            .table-of-contents ul { list-style-type: none; padding-left: 1.5rem; }
            .table-of-contents a { text-decoration: none; color: #58a6ff; }
            .table-of-contents a:hover { text-decoration: underline; }
        `,
        script: `
          const pid = window.location.pathname.split('_').pop().split('.')[0];
          const scrollFile = 'scroll_' + pid + '.json';
          setInterval(() => {
            fetch(scrollFile).then(r => r.json()).then(d => {
              const h = document.documentElement.scrollHeight - window.innerHeight;
              window.scrollTo({ top: d.percent * h, behavior: 'smooth' });
            }).catch(() => {});
          }, 100);
        `,
      },
    ],
    rehypeStringify,
  ],
};
