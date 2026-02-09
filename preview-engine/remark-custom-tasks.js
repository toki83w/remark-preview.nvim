import { visit } from "unist-util-visit";

export default function remarkCustomTasks() {
  return (tree) => {
    visit(tree, "listItem", (node) => {
      // Match also standard task items to treat all task items the same
      const isStandardTask = typeof node.checked === "boolean";
      let isCustomTask = false;
      let symbol = null;

      // 1. Detect if it's a custom task by checking text prefix
      const firstChild = node.children[0];
      if (
        firstChild?.type === "paragraph" &&
        firstChild.children[0]?.type === "text"
      ) {
        const textNode = firstChild.children[0];
        const match = textNode.value.match(/^\[(!|\?|>)\]\s*/);
        if (match) {
          isCustomTask = true;
          symbol = match[1];
          // Remove the custom symbol from the text
          textNode.value = textNode.value.replace(/^\[(!|\?|>)\]\s*/, "");
        }
      }

      // If it's not any kind of task, skip it
      if (!isStandardTask && !isCustomTask) return;

      // 2. Prepare classes
      const classes = ["task-list-item"];
      const taskMap = {
        "!": "task-important",
        "?": "task-question",
        ">": "task-ongoing",
      };

      if (isCustomTask) {
        classes.push("custom-task");
        classes.push(taskMap[symbol]);
      }

      node.data = node.data || {};
      node.data.hProperties = node.data.hProperties || {};
      node.data.hProperties.className = classes;

      // 3. Generate the manual checkbox HTML
      // Standard GFM keeps checkboxes disabled
      const isChecked = node.checked === true;
      const inputHtml = `<input type="checkbox" disabled${isChecked ? " checked" : ""}> `;

      // 4. Unwrap Paragraph and Inject Checkbox
      if (firstChild?.type === "paragraph") {
        node.children = [
          { type: "html", value: inputHtml },
          ...firstChild.children,
          ...node.children.slice(1),
        ];
      }

      // 5. IMPORTANT: Clean up 'checked' to prevent GFM/rehype handlers
      // from generating their own checkbox inside a paragraph
      delete node.checked;
    });
  };
}
