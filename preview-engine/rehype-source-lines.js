import { visit } from "unist-util-visit";

// Block elements that get their source lines. Scroll sync positions the preview between them.
const BLOCKS = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "ul", "ol", "li", "pre", "blockquote", "table", "hr", "details", "dl",
]);

/**
 * Adds data-line (first line) and data-line-end (last line) of the markdown source to block
 * elements. The lines are those of the whole file, frontmatter included, so they match the
 * line numbers in Neovim. Elements without a source position (generated ones) are skipped.
 */
export default function rehypeSourceLines() {
  return (tree) => {
    visit(tree, "element", (node) => {
      const position = node.position;
      if (!BLOCKS.has(node.tagName) || !position || !position.start || !position.end) {
        return;
      }
      node.properties = node.properties || {};
      node.properties["data-line"] = String(position.start.line);
      node.properties["data-line-end"] = String(position.end.line);
    });
  };
}
