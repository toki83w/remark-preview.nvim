import { visit } from "unist-util-visit";

// add a class equal to the theme name to the html and body,
// in order to select the correct colors in the css styles
// (required by the callout style)
export default function rehypeThemeClass(options = {}) {
  if (!options || typeof options.theme !== "string") {
    throw new Error(
      "rehypeThemeClass: 'theme' is a mandatory option and must be a string",
    );
  }

  return (tree) => {
    visit(tree, "element", (node) => {
      if (node.tagName === "html" || node.tagName === "body") {
        node.properties = node.properties || {};
        if (!node.properties.className) {
          node.properties.className = [];
        }
        if (!node.properties.className.includes(options.theme)) {
          node.properties.className.push(options.theme);
        }
      }
    });
  };
}
