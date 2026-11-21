-- Neovim configuration used by examples/preview.sh: this checkout of the plugin and nothing else.
-- Settings come from environment variables, so that no value is ever pasted into code:
--   REMARK_PREVIEW_ROOT        the checkout (default: the parent of this directory)
--   REMARK_PREVIEW_THEME       "dark", "light", "github-dark" or "github-light"
--   REMARK_PREVIEW_LOCAL_DIAGRAMS  "on" (default): mermaid and plantuml are drawn by merman-cli and plantuml
--                              when installed; "off": every diagram is drawn by the Kroki server
--   REMARK_PREVIEW_FOLLOW      "1": the browser follows the cursor
--   REMARK_PREVIEW_NO_BROWSER  "1": show the URL instead of opening a browser
-- You can copy this file as a starting point for your own configuration.
local root = vim.env.REMARK_PREVIEW_ROOT or vim.fn.fnamemodify(debug.getinfo(1).source:sub(2), ":p:h:h")
vim.opt.runtimepath:prepend(root)

if vim.env.REMARK_PREVIEW_NO_BROWSER == "1" then
    vim.ui.open = function(url)
        vim.notify("remark-preview: open this URL in a browser: " .. url, vim.log.levels.WARN)
        return {}, nil
    end
end

require("remark-preview").setup({
    theme = vim.env.REMARK_PREVIEW_THEME or "dark",
    local_diagrams = vim.env.REMARK_PREVIEW_LOCAL_DIAGRAMS ~= "off",
    sync_on_cursor = vim.env.REMARK_PREVIEW_FOLLOW == "1",
})

vim.g.mapleader = " "
vim.keymap.set("n", "<leader>mp", "<cmd>RemarkPreviewToggle<cr>", { desc = "Toggle Remark Preview" })
vim.keymap.set("n", "<leader>ms", "<cmd>RemarkPreviewSyncPosition<cr>", { desc = "Sync Preview Position" })
vim.keymap.set("n", "<leader>me", "<cmd>RemarkPreviewExport open<cr>", { desc = "Export & Open PDF" })

-- Start the preview of the file given on the command line once Neovim is up.
vim.api.nvim_create_autocmd("VimEnter", {
    once = true,
    callback = function()
        if vim.api.nvim_buf_get_name(0) ~= "" then
            vim.cmd("RemarkPreviewToggle")
        end
    end,
})
