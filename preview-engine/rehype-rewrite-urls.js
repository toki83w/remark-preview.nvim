import { visit } from "unist-util-visit";
import { createResolver } from "./links.js";

// Attributes holding a URL, per element.
const URL_ATTRIBUTES = {
  a: ["href"],
  img: ["src"],
  source: ["src"],
  video: ["src", "poster"],
  audio: ["src"],
};

function addClass(node, name) {
  const current = node.properties.className;
  const list = Array.isArray(current) ? current : current ? String(current).split(/\s+/) : [];
  if (!list.includes(name)) {
    list.push(name);
  }
  node.properties.className = list;
}

/**
 * Rewrites the URLs of links, images and media so they work in the preview:
 * local files go through the asset route of the preview server, links to other
 * markdown files open their own preview, anchors and external URLs are untouched.
 * Needs file.data.links (see createResolver); without it nothing is changed.
 */
export default function rehypeRewriteUrls() {
  return (tree, file) => {
    const links = file.data.links;
    if (!links) {
      return;
    }
    const resolver = createResolver(links);

    visit(tree, "element", (node) => {
      const attributes = URL_ATTRIBUTES[node.tagName];
      if (!attributes || !node.properties) {
        return;
      }
      for (const attribute of attributes) {
        const value = node.properties[attribute];
        if (typeof value !== "string") {
          continue;
        }
        const result = resolver.resolve(value, { link: node.tagName === "a" });
        if (result.kind === "asset" || result.kind === "doc") {
          node.properties[attribute] = result.url;
        } else if (result.kind === "blocked" || result.kind === "missing") {
          delete node.properties[attribute];
          addClass(node, result.kind === "blocked" ? "rp-blocked" : "rp-missing");
          node.properties.title = `${value}: ${result.reason}`;
        }
      }
    });
  };
}
