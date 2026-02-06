import { readFileSync } from "node:fs";
import { join } from "node:path";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkGithubAlerts from "remark-github-alerts";
import remarkMath from "remark-math";
import remarkKroki from "remark-kroki";
import remarkFlexibleToc from "remark-flexible-toc";
import remarkRehype from "remark-rehype";
import rehypeAsciimath from "@widcardw/rehype-asciimath";
import rehypeSlug from "rehype-slug";
import rehypeKatex from "rehype-katex";
import rehypeDocument from "rehype-document";
import rehypeStringify from "rehype-stringify";

const templateDir = process.env.PLUGIN_PATH;
const docDir = process.env.DOC_DIR;
const theme = process.env.PREVIEW_THEME || "dark";

let themeFile =
  theme === "light"
    ? "light.css"
    : theme === "print"
      ? "print.css"
      : "dark.css";

let cssContent = "";
try {
  cssContent = readFileSync(join(templateDir, themeFile), "utf8");
} catch (e) {
  cssContent =
    'body { font-family: "Noto Sans", sans-serif; background: #1e1e2e; }';
}

export default {
  plugins: [
    remarkParse,
    remarkGfm,
    remarkGithubAlerts,
    remarkMath,
    [remarkKroki, { server: "https://kroki.io", output: "inline-svg" }],
    [
      remarkFlexibleToc,
      {
        placeholder: "[toc]",
        containerTag: "nav",
        containerClassName: "table-of-contents",
      },
    ],
    [remarkRehype, { allowDangerousHtml: true }],
    rehypeSlug,
    rehypeAsciimath,
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
            @media screen {
                :root { --sidebar-width: 260px; }
                body { 
                    transition: margin-left 0.3s; 
                    margin-left: 45px; 
                    font-family: "Noto Sans", sans-serif !important; 
                }
                body.sidebar-open { margin-left: var(--sidebar-width); }

                .toc-sidebar {
                    position: fixed; left: calc(-1 * var(--sidebar-width)); top: 0;
                    width: var(--sidebar-width); height: 100vh;
                    background: ${theme === "dark" ? "#181825" : "#ffffff"};
                    border-right: 1px solid ${theme === "dark" ? "#313244" : "#d0d7de"};
                    overflow-y: auto; z-index: 1000;
                    transition: left 0.3s; padding: 20px 15px;
                    font-family: "Noto Sans", sans-serif !important;
                }
                .toc-sidebar.open { left: 0; }
                .toc-sidebar h3 { font-size: 1.1em; color: #cba6f7; margin-bottom: 15px; font-weight: 700; }
                .toc-sidebar a { 
                    display: block; padding: 6px 10px; text-decoration: none; 
                    color: #a6adc8; font-size: 0.85em; border-radius: 6px;
                }
                .toc-sidebar a.active { background: #89b4fa22; color: #89b4fa; font-weight: 700; }
                
                .toc-toggle {
                    position: fixed; left: 10px; top: 10px; z-index: 1001;
                    font-family: "Noto Sans", sans-serif !important;
                    background: #cba6f7; color: #11111b;
                    width: 32px; height: 32px; display: flex;
                    align-items: center; justify-content: center; border-radius: 8px;
                }

                li.custom-task { list-style: none !important; }
                li.custom-task input { display: none !important; }
                .task-icon { margin-right: 10px; font-style: normal; }
            }
        `,
        script: `
          window.addEventListener('DOMContentLoaded', () => {
              // 1. Sidebar Injection
              const sidebar = document.createElement('div');
              sidebar.className = 'toc-sidebar open';
              sidebar.innerHTML = '<h3>Contents</h3><ul id="sb-list"></ul>';
              document.body.appendChild(sidebar);
              document.body.classList.add('sidebar-open');

              const sbList = document.getElementById('sb-list');
              const headings = document.querySelectorAll('h1, h2, h3, h4');
              headings.forEach(h => {
                  if (!h.id) return;
                  const li = document.createElement('li');
                  const a = document.createElement('a');
                  a.href = '#' + h.id;
                  a.innerText = h.innerText;
                  a.className = 'depth-' + h.tagName.substring(1);
                  li.appendChild(a);
                  sbList.appendChild(li);
              });

              // 2. Toggle Button
              const btn = document.createElement('div');
              btn.className = 'toc-toggle';
              btn.innerHTML = '☰';
              btn.onclick = () => {
                  sidebar.classList.toggle('open');
                  document.body.classList.toggle('sidebar-open');
              };
              document.body.appendChild(btn);

              // 3. Scroll Spy
              const observer = new IntersectionObserver((entries) => {
                  entries.forEach(entry => {
                      if (entry.isIntersecting) {
                          document.querySelectorAll('.toc-sidebar a').forEach(a => a.classList.remove('active'));
                          const link = document.querySelector('.toc-sidebar a[href="#' + entry.target.id + '"]');
                          if (link) link.classList.add('active');
                      }
                  });
              }, { rootMargin: '0px 0px -80% 0px' });
              headings.forEach(h => observer.observe(h));

              // 4. Custom Task Markers
              document.querySelectorAll('li').forEach(li => {
                  const content = li.innerHTML.trim();
                  if (content.includes('[!]')) {
                      li.classList.add('task-important', 'custom-task');
                      li.innerHTML = li.innerHTML.replace('[!]', '<i class="task-icon">❗</i>');
                  } else if (content.includes('[?]')) {
                      li.classList.add('task-question', 'custom-task');
                      li.innerHTML = li.innerHTML.replace('[?]', '<i class="task-icon">❓</i>');
                  } else if (content.includes('[>]')) {
                      li.classList.add('task-ongoing', 'custom-task');
                      li.innerHTML = li.innerHTML.replace('[>]', '<i class="task-icon">⏳</i>');
                  }
              });
          });

          // 5. Scroll Sync
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
