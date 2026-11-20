local H = require("helpers")
local config = require("remark-preview.config")
local server = require("remark-preview.server")
local session = require("remark-preview.session")

local root = vim.fn.fnamemodify(debug.getinfo(1).source:sub(2), ":p:h:h")

local tests = {}

local function started(bufnr)
    local current = session.get(bufnr)
    return current ~= nil and current.url ~= nil
end

local function preview_path(bufnr)
    return string.format("/d/%s/", session.get(bufnr).id)
end

local function base_url()
    return string.format("http://127.0.0.1:%d", server.port())
end

tests["two buffers are previewed independently and only the saved one updates"] = function()
    local opened = H.capture_open()
    local dir = H.tmpdir()
    H.write(dir .. "/a.md", { "# Alpha", "", "alpha one" })
    H.write(dir .. "/b.md", { "# Beta", "", "beta one" })

    local buf_a = H.edit(dir .. "/a.md")
    session.start(buf_a)
    local buf_b = H.edit(dir .. "/b.md")
    session.start(buf_b)
    H.wait(function()
        return started(buf_a) and started(buf_b)
    end, 20000, "previews did not start")

    assert(session.get(buf_a).id ~= session.get(buf_b).id, "each document needs its own URL")
    assert(#opened == 2, "one browser tab per document")
    assert(opened[1]:find("127.0.0.1:" .. server.port(), 1, true), "must be a loopback URL")

    local jar = dir .. "/jar"
    assert(H.login(opened[1], jar):find("alpha one", 1, true))
    assert(H.login(opened[2], jar):find("beta one", 1, true))

    local sse_a = H.sse(base_url() .. preview_path(buf_a) .. "events?v=1", jar)
    local sse_b = H.sse(base_url() .. preview_path(buf_b) .. "events?v=1", jar)
    H.wait(function()
        return sse_a.text():find("retry:", 1, true) and sse_b.text():find("retry:", 1, true)
    end, 5000, "event streams did not connect")

    vim.api.nvim_buf_set_lines(buf_a, 2, 3, false, { "alpha two" })
    vim.api.nvim_buf_call(buf_a, function()
        vim.cmd("silent write")
    end)
    H.wait(function()
        return sse_a.text():find("alpha two", 1, true)
    end, 5000, "saving A did not update A")
    assert(sse_a.text():find("event: update", 1, true))
    vim.wait(500)
    assert(not sse_b.text():find("event: update", 1, true), "saving A must not update B")

    -- toggling A off keeps B (and the server) alive
    local page_a = base_url() .. preview_path(buf_a)
    local page_b = base_url() .. preview_path(buf_b)
    session.toggle(buf_a)
    assert(server.is_running(), "server must stay while a preview is active")
    H.wait(function()
        return H.status(page_a, jar) == 404
    end, 5000, "closed preview is still served")
    assert(H.status(page_b, jar) == 200)

    -- toggling the last one off stops the server
    local pid = server.pid()
    session.toggle(buf_b)
    assert(not server.is_running())
    H.wait(function()
        return not H.alive(pid)
    end, 5000, "server process still alive")
end

tests["requests need the token cookie"] = function()
    local opened = H.capture_open()
    local dir = H.tmpdir()
    H.write(dir .. "/a.md", { "# Auth" })
    local buf = H.edit(dir .. "/a.md")
    session.start(buf)
    H.wait(function()
        return started(buf)
    end, 20000, "preview did not start")

    local page = base_url() .. preview_path(buf)
    assert(H.status(page) == 401, "no cookie")
    assert(H.status(page .. "?t=wrong") == 401, "wrong token")
    local jar = dir .. "/jar"
    H.login(opened[1], jar)
    assert(H.status(page, jar) == 200, "cookie from the URL token")
end

tests["starting an active preview again re-opens the browser"] = function()
    local opened = H.capture_open()
    local dir = H.tmpdir()
    H.write(dir .. "/a.md", { "# Again" })
    local buf = H.edit(dir .. "/a.md")
    session.start(buf)
    H.wait(function()
        return started(buf)
    end, 20000)
    session.start(buf)
    assert(#opened == 2 and opened[1] == opened[2])
    assert(#session.active() == 1)
end

tests["a buffer without a file is refused"] = function()
    local messages = H.capture_notify()
    vim.cmd("enew")
    local buf = vim.api.nvim_get_current_buf()
    session.start(buf)
    assert(not session.is_active(buf))
    assert(not server.is_running())
    assert(#messages == 1 and messages[1].msg:find("save the buffer", 1, true))
end

tests["wiping a buffer ends its preview"] = function()
    H.capture_open()
    local dir = H.tmpdir()
    H.write(dir .. "/a.md", { "# A" })
    H.write(dir .. "/b.md", { "# B" })
    local buf_a = H.edit(dir .. "/a.md")
    session.start(buf_a)
    local buf_b = H.edit(dir .. "/b.md")
    session.start(buf_b)
    H.wait(function()
        return started(buf_a) and started(buf_b)
    end, 20000)

    vim.cmd("bwipeout! " .. buf_a)
    assert(not session.is_active(buf_a))
    assert(server.is_running())
    vim.cmd("bwipeout! " .. buf_b)
    assert(not session.is_active(buf_b))
    assert(not server.is_running(), "last preview closed, server must stop")
end

tests["a server that cannot listen reports why"] = function()
    local tcp = vim.uv.new_tcp()
    assert(tcp:bind("127.0.0.1", 0) == 0)
    tcp:listen(1, function() end)
    local port = tcp:getsockname().port
    config.setup({ port = port })

    local result
    server.start(function(ok, err)
        result = { ok = ok, err = err }
    end)
    H.wait(function()
        return result
    end, 15000, "no answer from server.start")
    tcp:close()
    assert(result.ok == false)
    assert(result.err:find("Cannot listen", 1, true), result.err)
    H.wait(function()
        return not server.is_running()
    end, 5000, "failed server must be forgotten")
end

tests["an unexpected server exit closes every preview"] = function()
    H.capture_open()
    local messages = H.capture_notify()
    local dir = H.tmpdir()
    H.write(dir .. "/a.md", { "# A" })
    local buf = H.edit(dir .. "/a.md")
    session.start(buf)
    H.wait(function()
        return started(buf)
    end, 20000)

    assert(vim.uv.kill(server.pid(), 15) == 0)
    H.wait(function()
        return not session.is_active(buf)
    end, 5000, "preview survived its server")
    local warned = false
    for _, message in ipairs(messages) do
        warned = warned or message.msg:find("stopped unexpectedly", 1, true) ~= nil
    end
    assert(warned, "the user must be told")
    assert(not server.is_running())
end

tests["the server does not outlive a killed Neovim"] = function()
    local dir = H.tmpdir()
    H.write(dir .. "/o.md", { "# Orphan" })
    local pidfile = dir .. "/pid"
    local child = vim.system({
        "nvim",
        "--headless",
        "-u",
        "NONE",
        "-l",
        root .. "/tests/orphan_child.lua",
        dir .. "/o.md",
        pidfile,
    })
    H.wait(function()
        return vim.fn.filereadable(pidfile) == 1 and #vim.fn.readfile(pidfile) > 0
    end, 30000, "child neovim did not start a preview")
    local pid = tonumber(vim.fn.readfile(pidfile)[1])
    assert(pid and H.alive(pid), "server must be running while its Neovim is")

    child:kill(9)
    H.wait(function()
        return not H.alive(pid)
    end, 10000, "server survived its Neovim")
end

return tests
