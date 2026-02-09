import { visit } from "unist-util-visit";

export default function remarkAmpersandMath() {
  return (tree) => {
    // 1. Build Math Nodes
    visit(tree, "text", (node, index, parent) => {
      const regex =
        /(?<!\\)&&([\s\S]+?)(?<!\\)&&|(?<!\\)&((?:\\&|[^&])+?)(?<!\\)&/g;
      const value = node.value;
      const nodes = [];
      let lastIndex = 0;
      let match;

      while ((match = regex.exec(value)) !== null) {
        if (match.index > lastIndex) {
          nodes.push({
            type: "text",
            value: value.slice(lastIndex, match.index).replace(/\\&/g, "&"),
          });
        }

        const mathValue = (match[1] || match[2]).trim();

        if (match[1]) {
          // Block Math
          nodes.push({
            type: "math",
            value: mathValue,
            data: {
              hName: "div",
              hProperties: { className: ["math", "math-display"] },
              // Pass the math text as a child of the div
              hChildren: [{ type: "text", value: mathValue }],
            },
          });
        } else if (match[2]) {
          // Inline Math
          nodes.push({
            type: "inlineMath",
            value: mathValue,
            data: {
              hName: "span",
              hProperties: { className: ["math", "math-inline"] },
              // Pass the math text as a child of the span
              hChildren: [{ type: "text", value: mathValue }],
            },
          });
        }
        lastIndex = regex.lastIndex;
      }

      if (nodes.length > 0) {
        if (lastIndex < value.length) {
          nodes.push({
            type: "text",
            value: value.slice(lastIndex).replace(/\\&/g, "&"),
          });
        }
        parent.children.splice(index, 1, ...nodes);
        return index + nodes.length;
      }

      if (node.value.includes("\\&")) {
        node.value = node.value.replace(/\\&/g, "&");
      }
    });

    // 2. Hoist Block Math
    visit(tree, "paragraph", (node, index, parent) => {
      const hasBlockMath = node.children.some((child) => child.type === "math");
      if (!hasBlockMath) return;

      const newNodes = [];
      let currentParagraph = null;

      for (const child of node.children) {
        if (child.type === "math") {
          if (currentParagraph) {
            newNodes.push(currentParagraph);
            currentParagraph = null;
          }
          newNodes.push(child);
        } else {
          if (!currentParagraph) {
            currentParagraph = { type: "paragraph", children: [] };
          }
          currentParagraph.children.push(child);
        }
      }

      if (currentParagraph) {
        newNodes.push(currentParagraph);
      }

      parent.children.splice(index, 1, ...newNodes);
      return index + newNodes.length;
    });
  };
}
