local config = require("remark-preview.config")
local server = require("remark-preview.server")
local util = require("remark-preview.util")

local M = {}

local augroup = vim.api.nvim_create_augroup("RemarkPreviewSessions", { clear = true })

-- Active previews, keyed by buffer number: { path, id, url, starting }.
local sessions = {}

local CURSOR_DEBOUNCE_MS = 150

local function detach(bufnr)
    pcall(vim.api.nvim_clear_autocmds, { group = augroup, buffer = bufnr })
end

local function close_timer(session)
    if session.timer then
        session.timer:stop()
        session.timer:close()
        session.timer = nil
    end
end

-- The line the cursor is on in the window showing the buffer (the current window if it shows it).
local function cursor_line(bufnr)
    local win = vim.api.nvim_get_current_buf() == bufnr and vim.api.nvim_get_current_win() or vim.fn.bufwinid(bufnr)
    if win and win > 0 then
        return vim.api.nvim_win_get_cursor(win)[1]
    end
    return math.max(1, vim.api.nvim_buf_get_mark(bufnr, '"')[1])
end

local function attach(bufnr)
    if config.options.sync_on_cursor then
        vim.api.nvim_create_autocmd({ "CursorMoved", "CursorMovedI" }, {
            group = augroup,
            buffer = bufnr,
            callback = function()
                local session = sessions[bufnr]
                if not session or session.starting then
                    return
                end
                session.timer = session.timer or vim.uv.new_timer()
                session.timer:stop()
                session.timer:start(
                    CURSOR_DEBOUNCE_MS,
                    0,
                    vim.schedule_wrap(function()
                        local current = sessions[bufnr]
                        if current and current == session and vim.api.nvim_buf_is_valid(bufnr) then
                            M.sync(bufnr, { quiet = true, only_if_moved = true })
                        end
                    end)
                )
            end,
        })
    end
    -- The server watches the file itself, so saves from any program are picked up.
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
            util.open_preview(session.url)
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
            server.stop_unless_retained()
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
                    util.open_preview(session.url)
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
    close_timer(session)
    if next(sessions) == nil then
        server.stop_unless_retained()
    elseif not session.starting then
        server.request({ type = "close", path = session.path }, "closed", function() end)
    end
end

function M.stop_all()
    for bufnr, session in pairs(sessions) do
        detach(bufnr)
        close_timer(session)
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

-- Shows the line the cursor is on in the browser.
-- opts.quiet: no messages (used by the automatic cursor follow); opts.only_if_moved: skip an unchanged line.
function M.sync(bufnr, opts)
    opts = opts or {}
    local session = sessions[bufnr]
    if not session or session.starting then
        if not opts.quiet then
            util.notify("no active preview for this buffer", vim.log.levels.WARN)
        end
        return
    end
    local line = cursor_line(bufnr)
    if opts.only_if_moved and session.synced_line == line then
        return
    end
    session.synced_line = line
    server.request({ type = "scroll", path = session.path, line = line }, "scrolled", function(message, err)
        if err then
            if not opts.quiet then
                util.notify("could not sync the preview: " .. err, vim.log.levels.WARN)
            end
        elseif message.viewers == 0 and not opts.quiet then
            util.notify("no browser is showing this preview, open it with :RemarkPreviewOpen")
        end
    end)
end

-- The server died: every preview is gone with it.
server.on_exit = function()
    local had_previews = next(sessions) ~= nil
    for bufnr, session in pairs(sessions) do
        detach(bufnr)
        close_timer(session)
    end
    sessions = {}
    if had_previews then
        util.notify("the preview server stopped unexpectedly, previews were closed", vim.log.levels.WARN)
    end
end

return M
