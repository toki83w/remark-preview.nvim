import rehypeAsciimath from "@widcardw/rehype-asciimath";
import rehypeCallouts from "rehype-callouts";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeKrokiImgBg from "./rehype-kroki-img-bg.js";
import rehypeRaw from "rehype-raw";
import rehypeRewriteUrls from "./rehype-rewrite-urls.js";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkAmpersandMath from "./remark-ampersand-math.js";
import remarkCustomTasks from "./remark-custom-tasks.js";
import remarkFlexibleToc from "remark-flexible-toc";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import remarkSubSuper from "./remark-sub-super.js";
import { remarkKroki } from "remark-kroki";
import { remarkMark } from "remark-mark-highlight";
import { toString } from "hast-util-to-string";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { VFile } from "vfile";

export const KROKI_ALIASES = ["bytefield", "graphviz", "mermaid", "plantuml", "svgbob", "wavedrom"];

export const DEFAULT_KROKI_SERVER = "https://kroki.io";

// Drops the YAML/TOML frontmatter nodes from the tree.
function removeFrontmatter() {
  return (tree) => {
    tree.children = tree.children.filter((node) => node.type !== "yaml" && node.type !== "toml");
  };
}

// Collects the headings (after rehype-slug assigned the ids) and the document title.
function collectHeadings() {
  return (tree, file) => {
    const headings = [];
    visit(tree, "element", (node) => {
      const match = /^h([1-6])$/.exec(node.tagName);
      if (match && node.properties && node.properties.id) {
        headings.push({
          depth: Number(match[1]),
          id: String(node.properties.id),
          text: toString(node).trim(),
        });
      }
    });
    file.data.headings = headings;
    const first = headings.find((h) => h.depth === 1) || headings[0];
    file.data.title = first ? first.text : "";
  };
}

/**
 * The unified plugin list producing the HTML body of a document.
 * Shared by the preview server and the legacy remark-cli configuration.
 *
 * @param {{ theme?: string, kroki?: { server?: string } | false }} options
 */
export function bodyPlugins({ theme = "dark", kroki = {} } = {}) {
  const plugins = [remarkParse, remarkFrontmatter, removeFrontmatter, remarkCustomTasks, [remarkGfm, { singleTilde: false }]];
  plugins.push(remarkAmpersandMath, remarkMath);
  if (kroki) {
    plugins.push([
      remarkKroki,
      {
        server: kroki.server || DEFAULT_KROKI_SERVER,
        output: "img-base64",
        alias: KROKI_ALIASES,
      },
    ]);
  }
  plugins.push(remarkMark, remarkSubSuper);
  plugins.push([
    remarkFlexibleToc,
    {
      placeholder: "[toc]",
      containerTag: "nav",
      containerClassName: "table-of-contents",
    },
  ]);
  plugins.push([remarkRehype, { allowDangerousHtml: true }]);
  // raw HTML becomes real elements, so images and links written as HTML are rewritten too
  plugins.push(rehypeRaw, rehypeRewriteUrls);
  plugins.push([rehypeKrokiImgBg, { aliases: KROKI_ALIASES }], rehypeSlug, collectHeadings, rehypeAsciimath, rehypeKatex);
  if (theme !== "print") {
    plugins.push(rehypeHighlight);
  }
  plugins.push(rehypeCallouts);
  return plugins;
}

function use(processor, entry) {
  return Array.isArray(entry) ? processor.use(...entry) : processor.use(entry);
}

const processors = new Map();

function getProcessor(theme, kroki) {
  const key = JSON.stringify([theme, kroki]);
  let processor = processors.get(key);
  if (!processor) {
    processor = unified();
    for (const entry of bodyPlugins({ theme, kroki })) {
      use(processor, entry);
    }
    processor.use(rehypeStringify, { allowDangerousHtml: true });
    processor.freeze();
    processors.set(key, processor);
  }
  return processor;
}

/**
 * Renders markdown to an HTML fragment.
 *
 * @param {string} text markdown source
 * @param {{ theme?: string, path?: string, kroki?: { server?: string } | false, links?: object }} ctx
 *   links: { root, docDir, assetBase, docLink } makes local URLs work in the preview (see links.js)
 * @returns {Promise<{ html: string, headings: Array<{depth: number, id: string, text: string}>, title: string }>}
 */
export async function render(text, ctx = {}) {
  const theme = ctx.theme || "dark";
  const kroki = ctx.kroki === undefined ? {} : ctx.kroki;
  const processor = getProcessor(theme, kroki);
  const file = await processor.process(new VFile({ value: text, path: ctx.path, data: { links: ctx.links } }));
  return {
    html: String(file),
    headings: file.data.headings || [],
    title: file.data.title || "",
  };
}
