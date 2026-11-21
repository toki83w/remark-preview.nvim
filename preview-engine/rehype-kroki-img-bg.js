import { visit } from "unist-util-visit";

const el = (tagName, properties, children = []) => ({ type: "element", tagName, properties, children });

const button = (act, title, label) =>
  el("button", { type: "button", dataAct: act, title, ariaLabel: title }, [{ type: "text", value: label }]);

// Wraps the img with alt property equal to a diagram name in a frame the page can zoom and pan
// (client/client.js): a white background improves the visibility of transparent diagrams
// (mermaid) in the dark theme, a viewport holds the image and gets the transform, and three
// buttons zoom out, reset and zoom in. Without the script (the PDF) it is a plain white box;
// the stylesheet hides the buttons.
// The elements are spans: a div is not allowed inside the paragraph holding the image, and the
// browser would then split the paragraph and leave it empty.
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
        (options.aliases.includes(node.properties.alt) || node.properties.dataKroki !== undefined)
      ) {
        parent.children.splice(
          index,
          1,
          el("span", { className: ["rp-diagram"], style: "background:#fff;border-radius:6px;" }, [
            el("span", { className: ["rp-diagram-viewport"] }, [node]),
            el("span", { className: ["rp-diagram-controls"] }, [
              button("out", "Zoom out", "\u2212"),
              button("reset", "Reset view", "\u27F2"),
              button("in", "Zoom in", "+"),
            ]),
          ]),
        );
      }
    });
  };
}
