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
    // Keeps [toc] for the document, but we'll also use it to build the sidebar
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
            
            @media screen {
                :root { --sidebar-width: 260px; }
                body { transition: margin-left 0.3s; margin-left: 40px; }
                body.sidebar-open { margin-left: var(--sidebar-width); }

                .toc-sidebar {
                    position: fixed; left: calc(-1 * var(--sidebar-width)); top: 0;
                    width: var(--sidebar-width); height: 100vh;
                    background: ${process.env.PREVIEW_THEME === "dark" ? "#181825" : "#ffffff"};
                    border-right: 1px solid ${process.env.PREVIEW_THEME === "dark" ? "#45475a" : "#d0d7de"};
                    overflow-y: auto; z-index: 1000;
                    transition: left 0.3s; padding: 20px 15px;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
                }
                .toc-sidebar.open { left: 0; }
                .toc-sidebar h3 { font-size: 1.2em; margin-bottom: 15px; color: #89b4fa; }
                .toc-sidebar ul { list-style: none; padding-left: 0; margin: 0; }
                .toc-sidebar li { margin: 8px 0; }
                .toc-sidebar a { 
                    text-decoration: none; color: inherit; font-size: 0.9em; 
                    display: block; padding: 4px 8px; border-radius: 4px;
                    transition: background 0.2s;
                }
                .toc-sidebar a.active { background: #58a6ff33; color: #58a6ff; font-weight: bold; }
                .toc-sidebar a:hover { background: #89b4fa22; }
                
                /* Indentation for nested headers */
                .toc-sidebar .depth-3 { padding-left: 20px; font-size: 0.85em; }
                .toc-sidebar .depth-4 { padding-left: 35px; font-size: 0.8em; }

                .toc-toggle {
                    position: fixed; left: 10px; top: 10px;
                    z-index: 1001; cursor: pointer;
                    background: #58a6ff; color: white;
                    width: 32px; height: 32px; display: flex;
                    align-items: center; justify-content: center;
                    border-radius: 6px; box-shadow: 0 2px 5px rgba(0,0,0,0.2);
                }
            }

            @media print { .toc-sidebar, .toc-toggle { display: none !important; } }
        `,
        script: `
          window.addEventListener('DOMContentLoaded', () => {
              // 1. Build sidebar structure
              const sidebar = document.createElement('div');
              sidebar.className = 'toc-sidebar open'; // Default open
              sidebar.innerHTML = '<h3>Table of Contents</h3><ul id="sidebar-list"></ul>';
              document.body.appendChild(sidebar);
              document.body.classList.add('sidebar-open');

              const list = document.getElementById('sidebar-list');
              
              // 2. Scan document for headings
              const headings = document.querySelectorAll('h1, h2, h3, h4');
              headings.forEach(h => {
                  if (!h.id) return;
                  const li = document.createElement('li');
                  const a = document.createElement('a');
                  a.href = '#' + h.id;
                  a.innerText = h.innerText;
                  a.className = 'depth-' + h.tagName.substring(1);
                  li.appendChild(a);
                  list.appendChild(li);
              });

              // 3. Toggle button
              const btn = document.createElement('div');
              btn.className = 'toc-toggle';
              btn.innerHTML = '☰';
              btn.onclick = () => {
                  sidebar.classList.toggle('open');
                  document.body.classList.toggle('sidebar-open');
              };
              document.body.appendChild(btn);

              // 4. Highlight Active Section (Intersection Observer)
              const observer = new IntersectionObserver((entries) => {
                  entries.forEach(entry => {
                      if (entry.isIntersecting) {
                          document.querySelectorAll('.toc-sidebar a').forEach(a => a.classList.remove('active'));
                          const activeLink = document.querySelector('.toc-sidebar a[href="#' + entry.target.id + '"]');
                          if (activeLink) activeLink.classList.add('active');
                      }
                  });
              }, { rootMargin: '0px 0px -80% 0px' });

              headings.forEach(h => observer.observe(h));
          });

          // Scroll Sync Logic
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
