local H = require("helpers")
local config = require("remark-preview.config")
local server = require("remark-preview.server")
local session = require("remark-preview.session")

local tests = {}

-- Starts a preview of a ten line file and connects a "browser" (an event stream) to it.
local function preview_with_viewer()
    local opened = H.capture_open()
    local dir = H.tmpdir()
    H.write(dir .. "/a.md", { "# Title", "", "one", "", "two", "", "three", "", "four", "" })
    local buf = H.edit(dir .. "/a.md")
    session.start(buf)
    H.wait(function()
        local current = session.get(buf)
        return current and current.url
    end, 20000, "preview did not start")

    local jar = dir .. "/jar"
    H.login(opened[1], jar)
    local events = string.format("http://127.0.0.1:%d/d/%s/events?v=1", server.port(), session.get(buf).id)
    local viewer = H.sse(events, jar)
    H.wait(function()
        return viewer.text():find("retry:", 1, true)
    end, 5000, "event stream did not connect")
    return buf, viewer
end

local function count(text, needle)
    return select(2, text:gsub(vim.pesc(needle), ""))
end

tests["sync tells the browser which line the cursor is on"] = function()
    local buf, viewer = preview_with_viewer()
    vim.api.nvim_win_set_cursor(0, { 7, 0 })
    session.sync(buf)
    H.wait(function()
        return viewer.text():find('event: scroll\ndata: {"line":7}', 1, true)
    end, 5000, "no scroll event for line 7")
end

tests["the sync command works through :RemarkPreviewSyncPosition"] = function()
    local buf, viewer = preview_with_viewer()
    require("remark-preview").setup({})
    vim.api.nvim_win_set_cursor(0, { 3, 0 })
    vim.cmd("RemarkPreviewSyncPosition")
    H.wait(function()
        return viewer.text():find('"line":3', 1, true)
    end, 5000, "no scroll event for line 3")
    assert(session.is_active(buf))
end

tests["without a browser showing the preview the user is told"] = function()
    local messages = H.capture_notify()
    H.capture_open()
    local dir = H.tmpdir()
    H.write(dir .. "/a.md", { "# Title", "", "text" })
    local buf = H.edit(dir .. "/a.md")
    session.start(buf)
    H.wait(function()
        local current = session.get(buf)
        return current and current.url
    end, 20000)

    session.sync(buf)
    H.wait(function()
        return vim.iter(messages):any(function(m)
            return m.msg:find("no browser is showing", 1, true) ~= nil
        end)
    end, 5000, "the user was not told")
end

tests["sync without a preview warns"] = function()
    local messages = H.capture_notify()
    vim.cmd("enew")
    session.sync(vim.api.nvim_get_current_buf())
    assert(#messages == 1 and messages[1].msg:find("no active preview", 1, true))
end

tests["sync_on_cursor follows the cursor, debounced"] = function()
    config.setup({ sync_on_cursor = true })
    local buf, viewer = preview_with_viewer()

    for line = 2, 6 do
        vim.api.nvim_win_set_cursor(0, { line, 0 })
        vim.api.nvim_exec_autocmds("CursorMoved", { buffer = buf })
    end
    H.wait(function()
        return viewer.text():find('"line":6', 1, true)
    end, 5000, "the cursor position never reached the browser")
    vim.wait(400)
    assert(count(viewer.text(), "event: scroll") == 1, "five quick moves must be sent as one: " .. viewer.text())
end

tests["sync_on_cursor does not repeat an unchanged line"] = function()
    config.setup({ sync_on_cursor = true })
    local buf, viewer = preview_with_viewer()

    vim.api.nvim_win_set_cursor(0, { 4, 0 })
    vim.api.nvim_exec_autocmds("CursorMoved", { buffer = buf })
    H.wait(function()
        return viewer.text():find('"line":4', 1, true)
    end, 5000)
    vim.api.nvim_exec_autocmds("CursorMoved", { buffer = buf })
    vim.wait(500)
    assert(count(viewer.text(), "event: scroll") == 1)
end

tests["the cursor is not followed unless sync_on_cursor is set"] = function()
    local buf, viewer = preview_with_viewer()
    vim.api.nvim_win_set_cursor(0, { 5, 0 })
    vim.api.nvim_exec_autocmds("CursorMoved", { buffer = buf })
    vim.wait(500)
    assert(not viewer.text():find("event: scroll", 1, true))
end

tests["closing the preview stops following the cursor"] = function()
    config.setup({ sync_on_cursor = true })
    local buf = preview_with_viewer()
    session.stop(buf)
    -- must not raise from a stale timer or autocmd
    vim.api.nvim_exec_autocmds("CursorMoved", { buffer = buf })
    vim.wait(400)
    assert(not session.is_active(buf))
end

return tests
