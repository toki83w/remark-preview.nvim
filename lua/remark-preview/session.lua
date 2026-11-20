local config = require("remark-preview.config")
local server = require("remark-preview.server")
local util = require("remark-preview.util")

local M = {}

local augroup = vim.api.nvim_create_augroup("RemarkPreviewSessions", { clear = true })

-- Active previews, keyed by buffer number: { path, id, url, starting }.
local sessions = {}

local function detach(bufnr)
    pcall(vim.api.nvim_clear_autocmds, { group = augroup, buffer = bufnr })
end

local function attach(bufnr)
    vim.api.nvim_create_autocmd("BufWritePost", {
        group = augroup,
        buffer = bufnr,
        callback = function()
            M.update(bufnr)
        end,
    })
    -- :bdelete and :bwipeout both end the preview of that buffer.
    vim.api.nvim_create_autocmd({ "BufDelete", "BufWipeout" }, {
        group = augroup,
        buffer = bufnr,
        callback = function()
            M.stop(bufnr)
        end,
    })
end

-- Returns a copy of the session of a buffer, or nil.
function M.get(bufnr)
    local session = sessions[bufnr]
    return session and vim.deepcopy(session) or nil
end

-- Buffer numbers with an active (or starting) preview.
function M.active()
    local buffers = vim.tbl_keys(sessions)
    table.sort(buffers)
    return buffers
end

function M.is_active(bufnr)
    return sessions[bufnr] ~= nil
end

-- Sends a changed file to the server; render errors are shown in the browser.
function M.update(bufnr)
    local session = sessions[bufnr]
    if not session or session.starting then
        return
    end
    if util.buffer_path(bufnr) ~= session.path then
        util.notify("the buffer was renamed, its preview was closed", vim.log.levels.INFO)
        M.stop(bufnr)
        return
    end
    server.request({ type = "update", path = session.path }, "updated", function(_, err)
        if err then
            util.notify("could not update the preview: " .. err, vim.log.levels.WARN)
        end
    end)
end

-- Starts the preview of a buffer. The browser is opened unless opts.open_browser == false.
function M.start(bufnr, opts)
    opts = opts or {}
    local session = sessions[bufnr]
    if session then
        if session.url and opts.open_browser ~= false then
            util.open_external(session.url)
        end
        return
    end

    local path = util.buffer_path(bufnr)
    if not path or vim.fn.filereadable(path) ~= 1 then
        util.notify("save the buffer to a file first, the preview reads the file from disk", vim.log.levels.WARN)
        return
    end

    session = { path = path, starting = true }
    sessions[bufnr] = session

    local function abort(message)
        if sessions[bufnr] == session then
            sessions[bufnr] = nil
        end
        if next(sessions) == nil then
            server.stop()
        end
        util.notify(message, vim.log.levels.ERROR)
    end

    server.start(function(ok, err)
        if not ok then
            return abort(err or "could not start the preview server")
        end
        server.request(
            { type = "open", path = path, theme = config.options.theme },
            "opened",
            function(message, open_err)
                if not message then
                    return abort(open_err or "could not open the preview")
                end
                if sessions[bufnr] ~= session then
                    -- stopped while the server was still starting
                    server.request({ type = "close", path = path }, "closed", function() end)
                    return
                end
                session.id = message.id
                session.url = message.url
                session.starting = nil
                attach(bufnr)
                if opts.open_browser ~= false then
                    util.open_external(session.url)
                end
            end
        )
    end)
end

-- Ends the preview of a buffer; the server stops with its last preview.
function M.stop(bufnr)
    local session = sessions[bufnr]
    if not session then
        return
    end
    sessions[bufnr] = nil
    detach(bufnr)
    if next(sessions) == nil then
        server.stop()
    elseif not session.starting then
        server.request({ type = "close", path = session.path }, "closed", function() end)
    end
end

function M.stop_all()
    for bufnr in pairs(sessions) do
        detach(bufnr)
    end
    sessions = {}
    server.stop()
end

function M.toggle(bufnr)
    if sessions[bufnr] then
        M.stop(bufnr)
    else
        M.start(bufnr)
    end
end

-- Restarts the server and re-opens every active preview.
function M.restart()
    local buffers = M.active()
    M.stop_all()
    for _, bufnr in ipairs(buffers) do
        if vim.api.nvim_buf_is_valid(bufnr) then
            M.start(bufnr)
        end
    end
end

-- Scroll sync is rebuilt on top of the new server (line-accurate); not available yet.
function M.sync(bufnr)
    if not sessions[bufnr] then
        util.notify("no active preview for this buffer", vim.log.levels.WARN)
        return
    end
    util.notify("scroll sync is not available yet in the new preview server", vim.log.levels.WARN)
end

-- The server died: every preview is gone with it.
server.on_exit = function()
    local had_previews = next(sessions) ~= nil
    for bufnr in pairs(sessions) do
        detach(bufnr)
    end
    sessions = {}
    if had_previews then
        util.notify("the preview server stopped unexpectedly, previews were closed", vim.log.levels.WARN)
    end
end

return M
