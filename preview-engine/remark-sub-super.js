import { visit } from "unist-util-visit";

export default function remarkSubSuper() {
  return (tree) => {
    visit(tree, "text", (node, index, parent) => {
      // Regex:
      // (~([^~]+)~) matches ~text~ for subscript
      // (\^([^^]+)\^) matches ^text^ for superscript
      const regex = /(~([^~]+)~)|(\^([^^]+)\^)/g;
      const value = node.value;
      const nodes = [];
      let lastIndex = 0;
      let match;

      while ((match = regex.exec(value)) !== null) {
        // Add text before the match
        if (match.index > lastIndex) {
          nodes.push({
            type: "text",
            value: value.slice(lastIndex, match.index),
          });
        }

        if (match[1]) {
          // Subscript match ~...~
          nodes.push({
            type: "html",
            value: `<sub>${match[2]}</sub>`,
          });
        } else if (match[3]) {
          // Superscript match ^...^
          nodes.push({
            type: "html",
            value: `<sup>${match[4]}</sup>`,
          });
        }

        lastIndex = regex.lastIndex;
      }

      // Add remaining text
      if (lastIndex < value.length) {
        nodes.push({ type: "text", value: value.slice(lastIndex) });
      }

      // Replace the original text node with the new sequence
      if (nodes.length > 0) {
        parent.children.splice(index, 1, ...nodes);
        return index + nodes.length; // Skip the newly created nodes
      }
    });
  };
}
