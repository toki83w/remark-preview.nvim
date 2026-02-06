# remark-preview.nvim

A lightweight, highly customizable Markdown previewer for Neovim that utilizes the **remark-rehype** ecosystem to render GFM-compliant HTML directly in your browser.

## Features

* **Custom Engine**: Powered by `remark-rehype` for exact control over HTML output.
* **PID Isolation**: Run multiple Neovim instances simultaneously without port collisions.
* **Scroll Sync**: The browser automatically follows your Neovim cursor.
* **Themeable**: Built-in **Catppuccin Mocha** (dark) and GitHub (light) themes.
* **Zero Project Clutter**: Generated files are stored in the system's temporary directory.
* **Platform Independent**: Optimized for **Windows** and **Linux**.


## Prerequisites

This plugin requires **Node.js** and the following global npm packages:

```bash
npm install -g remark-cli remark-parse remark-gfm remark-rehype rehype-document rehype-stringify live-server
```


## Installation

Using [lazy.nvim](https://github.com/folke/lazy.nvim)

```lua
{
    "toki83w/remark-preview.nvim",
    ft = "markdown",
    opts = {
        theme = "dark", -- "dark" or "light"
        port_base = 8080,
    },
    keys = {
        { "<leader>mp", "<cmd>RemarkPreviewToggle<cr>", desc = "Toggle Remark Preview" }
    },
    config = function(_, opts)
        require("remark-preview").setup(opts)
    end
}
```


## Configuration

| Option    | Default | Description                                  |
|-----------|---------|----------------------------------------------|
| theme     | "dark"  | Sets the CSS theme injected into the preview |
| port_base | 8080    | Starting port for the local server           |


## Troubleshooting

Run the built-in health check

```vimscript
:checkhealth remark-preview
```


## License

MIT
