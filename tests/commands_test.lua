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
    H.wait(function()
        return vim.iter(messages):any(function(m)
            return m.msg:find("no browser is showing", 1, true) ~= nil
        end)
    end, 5000, "sync must tell that no browser shows the preview")

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

tests["a file written by another program is rendered, and the refresh command renders on demand"] = function()
    local messages = H.capture_notify()
    H.capture_open()
    require("remark-preview").setup({})
    local dir = H.tmpdir()
    H.write(dir .. "/a.md", { "# A", "", "before" })
    local buf = H.edit(dir .. "/a.md")

    vim.cmd("RemarkPreviewRefresh")
    assert(
        vim.iter(messages):any(function(m)
            return m.msg:find("no active preview", 1, true) ~= nil
        end),
        "refresh without a preview must say so"
    )

    session.start(buf)
    H.wait(function()
        return session.get(buf) and session.get(buf).url
    end, 20000, "preview did not start")
    local jar = dir .. "/jar"
    local url = string.format("http://127.0.0.1:%d/d/%s/", server.port(), session.get(buf).id)
    H.login(session.get(buf).url, jar)
    local sse = H.sse(url .. "events?v=1", jar)
    H.wait(function()
        return sse.text():find("retry:", 1, true)
    end, 5000, "event stream did not connect")

    -- written behind Neovim's back: no write event is involved
    H.write(dir .. "/a.md", { "# A", "", "from outside" })
    H.wait(function()
        return sse.text():find("from outside", 1, true)
    end, 5000, "an external write did not update the preview")

    vim.cmd("RemarkPreviewRefresh")
    H.wait(function()
        return select(2, sse.text():gsub("event: update", "")) >= 2
    end, 5000, "refresh did not render again")
    vim.cmd("RemarkPreviewStopAll")
end

tests["browser_command opens the preview URL with a function or a command"] = function()
    local opened = H.capture_open()
    local messages = H.capture_notify()
    local dir = H.tmpdir()
    H.write(dir .. "/a.md", { "# A" })
    local buf = H.edit(dir .. "/a.md")

    local urls = {}
    require("remark-preview").setup({
        browser_command = function(url)
            table.insert(urls, url)
        end,
    })
    session.start(buf)
    H.wait(function()
        return session.get(buf) and session.get(buf).url
    end, 20000, "preview did not start")
    assert(#urls == 1 and urls[1] == session.get(buf).url, "the function receives the URL")
    assert(#opened == 0, "the system handler is not used")

    -- a command gets the URL appended as its last argument
    local out = dir .. "/args"
    local script = dir .. "/opener.sh"
    H.write(script, { "#!/bin/sh", 'echo "$@" > ' .. vim.fn.shellescape(out) })
    vim.fn.setfperm(script, "rwxr-xr-x")
    require("remark-preview").setup({ browser_command = { script, "--new-window" } })
    session.start(buf)
    H.wait(function()
        return vim.fn.filereadable(out) == 1 and #vim.fn.readfile(out) > 0
    end, 5000, "the command was not run")
    assert(vim.fn.readfile(out)[1] == "--new-window " .. session.get(buf).url)

    -- an invalid value falls back to the system handler
    require("remark-preview").setup({ browser_command = 42 })
    assert(require("remark-preview.config").options.browser_command == nil)
    H.wait(function()
        return vim.iter(messages):any(function(m)
            return m.msg:find("browser_command", 1, true) ~= nil
        end)
    end, 2000, "an invalid browser_command must be reported")
    session.start(buf)
    assert(#opened == 1, "the system handler is used again")
    session.stop_all()
end

return tests
