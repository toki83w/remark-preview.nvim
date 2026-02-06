import { readFileSync } from "node:fs";
import { join } from "node:path";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeDocument from "rehype-document";
import rehypeStringify from "rehype-stringify";

const templateDir = process.env.PLUGIN_PATH;
const theme = process.env.PREVIEW_THEME === "light" ? "light.css" : "dark.css";
const cssContent = readFileSync(join(templateDir, theme), "utf8");

export default {
  plugins: [
    remarkParse,
    remarkGfm,
    [remarkRehype, { allowDangerousHtml: true }],
    [
      rehypeDocument,
      {
        style: cssContent,
        script: `
          const pid = window.location.pathname.split('_').pop().split('.')[0];
          setInterval(() => {
            fetch('scroll_' + pid + '.json').then(r => r.json()).then(d => {
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
