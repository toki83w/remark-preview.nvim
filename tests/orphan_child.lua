-- Child Neovim of the "no orphan" test: starts a preview, reports the server pid, then idles
-- until the test kills this process with SIGKILL.
local root = vim.fn.fnamemodify(debug.getinfo(1).source:sub(2), ":p:h:h")
vim.opt.runtimepath:prepend(root)
vim.ui.open = function()
    return {}, nil
end

local md, pidfile = arg[1], arg[2]
require("remark-preview").setup({})
local session = require("remark-preview.session")

vim.cmd.edit(vim.fn.fnameescape(md))
local bufnr = vim.api.nvim_get_current_buf()
session.start(bufnr)
vim.wait(20000, function()
    local current = session.get(bufnr)
    return current and current.url ~= nil
end, 20)

vim.fn.writefile({ tostring(require("remark-preview.server").pid()) }, pidfile)
vim.wait(120000)
