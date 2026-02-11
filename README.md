# remark-preview.nvim

A high-performance, highly customizable Markdown previewer for Neovim that utilizes the **remark-rehype** ecosystem to render GFM-compliant HTML, diagrams, and complex math directly in your browser.

## 🚀 Features

*   **On-Demand Sync**: Synchronize the browser scroll position to match your Neovim cursor with a single command.
*   **Extended Math Support**:
    *   Standard LaTeX via `$...$` and `$$...$$`.
    *   **Ampersand Math**: Use `&...&` for inline and `&&...&&` for block **AsciiMath** (powered by KaTeX and rehype-asciimath).
*   **Diagrams (Kroki)**: Native support for Mermaid, PlantUML, Graphviz, and more. Transparent diagrams are automatically wrapped in high-contrast backgrounds for dark mode visibility.
*   **Advanced Task Lists**:
    *   Standard GFM `[ ]` and `[x]`.
    *   **Custom Markers**: Support for `[!]` (Important), `[?]` (Question), and `[>]` (Ongoing) with unique Nerd Font icons.
*   **Callouts & Alerts**: Support for GitHub-style alerts and Obsidian-style callouts (`[!NOTE]`, `[!WARNING]`, etc.).
*   **Styling & Themes**:
    *   Unified **Catppuccin** Mocha (Dark) and Latte (Light) themes.
    *   Automatic theme switching via configuration.
    *   Optimized **Print Theme** for B&W paper exports.
*   **Metadata Awareness**: Automatically ignores YAML/TOML frontmatter during rendering.
*   **Subscript & Superscript**: Native support for `~sub~` and `^super^` syntax.

## 🛠 Prerequisites

Before installing, ensure you have the following installed on your system:

*   **Node.js** (LTS recommended)
*   **npm** (bundled with Node.js)
*   **Nerd Fonts**: Required for viewing custom task icons correctly.

## 📦 Installation

### Using [lazy.nvim](https://github.com/folke/lazy.nvim)

```lua
{
    "toki83w/remark-preview.nvim",
    ft = "markdown",
    -- Automatically install/update npm dependencies
    build = "npm install --prefix preview-engine",
    opts = {
        theme = "dark", -- "dark" (Mocha) or "light" (Latte)
        port_base = 8080,
        pdf = {
            format = "A4",
            margin = "1cm"
        },
    },
    keys = {
        { "<leader>mp", "<cmd>RemarkPreviewToggle<cr>", desc = "Toggle Remark Preview" },
        { "<leader>ms", "<cmd>RemarkPreviewSyncPosition<cr>", desc = "Sync Preview Position" },
        { "<leader>me", "<cmd>RemarkPreviewExport open<cr>", desc = "Export & Open PDF" },
    },
}
```

## ⌨️ Commands

*   `:RemarkPreviewToggle`: Starts or stops the live preview server.
*   `:RemarkPreviewOpen`: Opens the preview in the browser (starts server if inactive).
*   `:RemarkPreviewSyncPosition`: Manually syncs the browser scroll to the current Neovim line.
*   `:RemarkPreviewExport [open]`: Exports the current file to PDF using the print theme. Optional `open` argument opens the PDF immediately.
*   `:RemarkPreviewRestart`: Restarts the preview server.
*   `:RemarkPreviewInstallDeps`: Triggers the installation of local NPM dependencies.
*   `:checkhealth remark-preview`: Verifies the installation of binaries and Node packages.

## 📝 Syntax Examples

### Ampersand Math (AsciiMath)
Inline: `&x^2 + y^2 = r^2&`
Block:
```text
&&
E = mc^2
&&
```

### Custom Task Markers
```markdown
- [!] This is urgent
- [?] I have a question about this
- [>] This task is currently in progress
- [x] This is already done
```

### Sub/Superscript
Water is H~2~O. The area is 10m^2^.

## ⚙️ Configuration

```lua
require("remark-preview").setup({
  theme = "dark",       -- "dark" or "light"
  port_base = 8080,     -- Starting port for the local server
  pdf = {
    format = "A4",
    margin = "1cm"
  }
})
```

## 📄 License

MIT
