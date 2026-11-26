local config = require("remark-preview.config")
local export = require("remark-preview.export")
local server = require("remark-preview.server")
local session = require("remark-preview.session")
local util = require("remark-preview.util")

local M = {}

M.config = config.options

function M.install_deps()
    local path = util.engine_path("")
    local cmd = string.format("cd %s && npm install", vim.fn.shellescape(path))

    util.notify("installing dependencies in " .. path)

    -- Run in a terminal split so the user can see progress
    vim.cmd("split | term " .. cmd)
end

-- Each of these acts on the current buffer.
function M.toggle()
    session.toggle(vim.api.nvim_get_current_buf())
end

function M.open()
    session.start(vim.api.nvim_get_current_buf())
end

function M.restart()
    session.restart()
end

function M.stop_all()
    session.stop_all()
end

function M.sync_preview()
    session.sync(vim.api.nvim_get_current_buf())
end

-- Renders the file of the current buffer again (the preview shows the file on disk, not unsaved text).
function M.refresh()
    local bufnr = vim.api.nvim_get_current_buf()
    if not session.is_active(bufnr) then
        util.notify("no active preview for this buffer", vim.log.levels.WARN)
        return
    end
    session.update(bufnr)
end

function M.export_pdf(open_after)
    export.export_pdf(vim.api.nvim_get_current_buf(), open_after)
end

function M.setup(opts)
    M.config = config.setup(opts)

    if vim.fn.has("nvim-0.10") ~= 1 then
        util.notify("Neovim 0.10 or newer is required", vim.log.levels.ERROR)
        return
    end

    vim.api.nvim_create_user_command("RemarkPreviewInstallDeps", M.install_deps, {})

    vim.api.nvim_create_user_command("RemarkPreviewOpen", M.open, {})
    vim.api.nvim_create_user_command("RemarkPreviewToggle", M.toggle, {})
    vim.api.nvim_create_user_command("RemarkPreviewRestart", M.restart, {})
    vim.api.nvim_create_user_command("RemarkPreviewStopAll", M.stop_all, {})

    vim.api.nvim_create_user_command("RemarkPreviewRefresh", M.refresh, {})
    vim.api.nvim_create_user_command("RemarkPreviewSyncPosition", M.sync_preview, {})

    vim.api.nvim_create_user_command("RemarkPreviewExport", function(cmd_opts)
        M.export_pdf(cmd_opts.args == "open")
    end, { nargs = "?" })

    local problems = server.check()
    if #problems > 0 then
        vim.schedule(function()
            util.notify(table.concat(problems, "; "), vim.log.levels.WARN)
        end)
    end

    -- The server also exits by itself when Neovim goes away; this just makes it prompt.
    local group = vim.api.nvim_create_augroup("RemarkPreview", { clear = true })
    vim.api.nvim_create_autocmd("VimLeavePre", {
        group = group,
        callback = function()
            session.stop_all()
        end,
    })
end

return M
