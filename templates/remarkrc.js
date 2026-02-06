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
            
            /* Sidebar & Custom Task Styles - Media Screen Only */
            @media screen {
                :root { --sidebar-width: 260px; }
                body { transition: margin-left 0.3s; margin-left: 45px; }
                body.sidebar-open { margin-left: var(--sidebar-width); }

                .toc-sidebar {
                    position: fixed; left: calc(-1 * var(--sidebar-width)); top: 0;
                    width: var(--sidebar-width); height: 100vh;
                    background: ${theme === "dark" ? "#181825" : "#ffffff"};
                    border-right: 1px solid ${theme === "dark" ? "#45475a" : "#d0d7de"};
                    overflow-y: auto; z-index: 1000;
                    transition: left 0.3s; padding: 20px 15px;
                    font-family: -apple-system, sans-serif;
                }
                .toc-sidebar.open { left: 0; }
                .toc-sidebar h3 { font-size: 1.1em; color: #89b4fa; margin-bottom: 15px; }
                .toc-sidebar ul { list-style: none; padding: 0; }
                .toc-sidebar a { 
                    display: block; padding: 5px 10px; text-decoration: none; 
                    color: inherit; font-size: 0.9em; border-radius: 4px;
                }
                .toc-sidebar a.active { background: #58a6ff33; color: #58a6ff; font-weight: bold; }
                .toc-sidebar .depth-3 { padding-left: 20px; }
                .toc-sidebar .depth-4 { padding-left: 35px; }

                .toc-toggle {
                    position: fixed; left: 10px; top: 10px; z-index: 1001;
                    cursor: pointer; background: #58a6ff; color: white;
                    width: 32px; height: 32px; display: flex;
                    align-items: center; justify-content: center; border-radius: 6px;
                }

                /* Custom Task List Visuals */
                .task-important { color: #f38ba8 !important; font-weight: bold; }
                .task-question { color: #f9e2af !important; font-style: italic; }
                .task-ongoing { color: #89b4fa !important; }
                li.custom-task { list-style: none !important; }
                li.custom-task input { display: none; }
            }

            @media print { .toc-sidebar, .toc-toggle { display: none !important; } }
        `,
        script: `
          window.addEventListener('DOMContentLoaded', () => {
              // 1. Sidebar Initialization
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

              const btn = document.createElement('div');
              btn.className = 'toc-toggle';
              btn.innerHTML = '☰';
              btn.onclick = () => {
                  sidebar.classList.toggle('open');
                  document.body.classList.toggle('sidebar-open');
              };
              document.body.appendChild(btn);

              // 2. Intersection Observer (Scroll Spy)
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

              // 3. Custom Task List Processing
              document.querySelectorAll('li').forEach(li => {
                  const text = li.innerText.trim();
                  let icon = "";
                  if (text.startsWith('[!]')) {
                      li.classList.add('task-important', 'custom-task');
                      icon = "❗ ";
                      li.innerHTML = li.innerHTML.replace('[!]', icon);
                  } else if (text.startsWith('[?]')) {
                      li.classList.add('task-question', 'custom-task');
                      icon = "❓ ";
                      li.innerHTML = li.innerHTML.replace('[?]', icon);
                  } else if (text.startsWith('[>]')) {
                      li.classList.add('task-ongoing', 'custom-task');
                      icon = "⏳ ";
                      li.innerHTML = li.innerHTML.replace('[>]', icon);
                  }
              });
          });

          // 4. Neovim Scroll Sync
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
