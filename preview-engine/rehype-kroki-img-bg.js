import { visit } from "unist-util-visit";

// adds a white background to the img with alt property equal to a diagram name,
// to improve the visibility of transparent diagrams (mermaid) in the dark theme
export default function rehypeKrokiImgBg(options = {}) {
  if (!options || !Array.isArray(options.aliases)) {
    throw new Error(
      "rehypeKrokiImgBg: 'aliases' is a mandatory option and must be an array",
    );
  }

  return (tree) => {
    visit(tree, "element", (node, index, parent) => {
      if (
        node.tagName === "img" &&
        parent &&
        Array.isArray(parent.children) &&
        node.properties &&
        options.aliases.includes(node.properties.alt)
      ) {
        parent.children.splice(index, 1, {
          type: "element",
          tagName: "div",
          properties: {
            style:
              "background:#fff;padding:8px;display:inline-block;border-radius:6px;",
          },
          children: [node],
        });
      }
    });
  };
}
