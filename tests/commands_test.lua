local H = require("helpers")
local server = require("remark-preview.server")
local session = require("remark-preview.session")

local tests = {}

tests["the commands act on the current buffer"] = function()
    local opened = H.capture_open()
    local messages = H.capture_notify()
    require("remark-preview").setup({})

    local dir = H.tmpdir()
    H.write(dir .. "/a.md", { "# Commands" })
    local buf = H.edit(dir .. "/a.md")

    vim.cmd("RemarkPreviewToggle")
    H.wait(function()
        local current = session.get(buf)
        return current and current.url
    end, 20000, "toggle did not start the preview")
    assert(#opened == 1)

    vim.cmd("RemarkPreviewOpen")
    assert(#opened == 2, "Open re-opens the browser of an active preview")

    vim.cmd("RemarkPreviewSyncPosition")
    local warned = false
    for _, message in ipairs(messages) do
        warned = warned or message.msg:find("scroll sync", 1, true) ~= nil
    end
    assert(warned, "sync is announced as unavailable until the line sync is built")

    vim.cmd("RemarkPreviewToggle")
    assert(not session.is_active(buf))
    assert(not server.is_running())

    vim.cmd("RemarkPreviewToggle")
    H.wait(function()
        return session.is_active(buf) and session.get(buf).url ~= nil
    end, 20000)
    vim.cmd("RemarkPreviewStopAll")
    assert(#session.active() == 0)
    assert(not server.is_running())
end

tests["restart re-opens every active preview on a new server"] = function()
    local opened = H.capture_open()
    local dir = H.tmpdir()
    H.write(dir .. "/a.md", { "# A" })
    local buf = H.edit(dir .. "/a.md")
    session.start(buf)
    H.wait(function()
        return session.get(buf) and session.get(buf).url
    end, 20000)
    local first_pid = server.pid()

    session.restart()
    H.wait(function()
        return session.get(buf) and session.get(buf).url and #opened == 2
    end, 20000, "preview was not re-opened")
    assert(server.pid() ~= first_pid, "a new server process")
    assert(not H.alive(first_pid) or vim.wait(3000, function()
        return not H.alive(first_pid)
    end))
end

return tests
