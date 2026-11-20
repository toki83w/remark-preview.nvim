local M = {}

local restores = {}

-- Runs fn when the current test is over (see restore()).
local function on_restore(fn)
    table.insert(restores, fn)
end

function M.restore()
    for i = #restores, 1, -1 do
        pcall(restores[i])
    end
    restores = {}
end

function M.wait(condition, timeout, message)
    local ok = vim.wait(timeout or 5000, condition, 20)
    assert(ok, message or "timed out")
end

function M.tmpdir()
    local dir = vim.fn.tempname()
    vim.fn.mkdir(dir, "p")
    on_restore(function()
        vim.fn.delete(dir, "rf")
    end)
    return dir
end

function M.write(path, lines)
    vim.fn.writefile(lines, path)
end

-- Replaces vim.ui.open: records the URLs instead of launching a browser.
function M.capture_open()
    local original = vim.ui.open
    local opened = {}
    vim.ui.open = function(target)
        table.insert(opened, target)
        return {}, nil
    end
    on_restore(function()
        vim.ui.open = original
    end)
    return opened
end

-- Replaces vim.notify: records the messages.
function M.capture_notify()
    local original = vim.notify
    local messages = {}
    vim.notify = function(msg, level)
        table.insert(messages, { msg = msg, level = level })
    end
    on_restore(function()
        vim.notify = original
    end)
    return messages
end

local function curl(args)
    local cmd = vim.list_extend({ "curl", "-s", "-m", "10" }, args)
    return vim.system(cmd, { text = true }):wait()
end

-- HTTP status code of a GET request, optionally with a cookie jar.
function M.status(url, jar)
    local args = { "-o", "/dev/null", "-w", "%{http_code}" }
    if jar then
        vim.list_extend(args, { "-b", jar })
    end
    table.insert(args, url)
    return tonumber(curl(args).stdout)
end

-- Opens the preview URL like a browser: follows the redirect and keeps the cookie.
-- Returns the page body.
function M.login(url, jar)
    return curl({ "-L", "-c", jar, "-b", jar, url }).stdout
end

function M.get(url, jar)
    return curl({ "-b", jar, url }).stdout
end

-- Follows a Server-Sent Events stream; text() returns everything received so far.
function M.sse(url, jar)
    local chunks = {}
    local proc = vim.system({ "curl", "-sN", "-b", jar, url }, {
        text = true,
        stdout = function(_, data)
            if data then
                table.insert(chunks, data)
            end
        end,
    })
    local stream = {
        text = function()
            return table.concat(chunks)
        end,
        stop = function()
            proc:kill(15)
        end,
    }
    on_restore(stream.stop)
    return stream
end

function M.alive(pid)
    if vim.uv.kill(pid, 0) ~= 0 then
        return false
    end
    -- a zombie (not yet reaped) is dead for our purposes
    local stat = io.open("/proc/" .. pid .. "/stat", "r")
    if stat then
        local content = stat:read("*a")
        stat:close()
        if content:match("^%d+ %b() (%a)") == "Z" then
            return false
        end
    end
    return true
end

-- Opens a file in a new buffer and returns its number.
function M.edit(path)
    vim.cmd.edit(vim.fn.fnameescape(path))
    return vim.api.nvim_get_current_buf()
end

return M
