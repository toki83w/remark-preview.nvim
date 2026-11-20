local config = require("remark-preview.config")
local util = require("remark-preview.util")

local M = {}

local MAX_STDERR_LINES = 20

-- State of the single preview server process owned by this Neovim instance.
local state = {
    job = nil, -- channel id of the running process
    ready = false,
    port = nil,
    token = nil,
    waiting = {}, -- callbacks waiting for the "ready" message
    pending = {}, -- ordered { key, path, callback } of requests awaiting an answer
    partial = "", -- incomplete stdout line
    stderr = {}, -- last stderr lines, for error messages
    retained = 0, -- work in flight (exports) that must not lose its server
}

-- Called when the server process ended without being stopped by us.
M.on_exit = nil

-- Returns the list of problems that prevent the server from starting.
function M.check()
    local problems = {}
    if vim.fn.executable("node") ~= 1 then
        table.insert(problems, "node is not installed or not in PATH")
    end
    if vim.fn.filereadable(util.engine_path("server.js")) ~= 1 then
        table.insert(problems, "preview-engine/server.js is missing")
    end
    if vim.fn.isdirectory(util.engine_path("node_modules/morphdom")) ~= 1 then
        table.insert(problems, "npm dependencies are missing, run :RemarkPreviewInstallDeps")
    end
    return problems
end

local function reset()
    state.job = nil
    state.ready = false
    state.port = nil
    state.token = nil
    state.partial = ""
    state.stderr = {}
end

-- Fails every waiting callback and pending request with the given message.
local function fail_all(message)
    local waiting = state.waiting
    local pending = state.pending
    state.waiting = {}
    state.pending = {}
    for _, callback in ipairs(waiting) do
        callback(false, message)
    end
    for _, request in ipairs(pending) do
        request.callback(nil, message)
    end
end

local function take_pending(predicate)
    for index, request in ipairs(state.pending) do
        if predicate(request) then
            table.remove(state.pending, index)
            return request
        end
    end
end

local function handle_message(message)
    local kind = message.type
    if kind == "ready" then
        state.ready = true
        state.port = message.port
        state.token = message.token
        util.debug(string.format("server ready on port %d", message.port))
        local waiting = state.waiting
        state.waiting = {}
        for _, callback in ipairs(waiting) do
            callback(true)
        end
    elseif kind == "fatal" then
        util.debug("server fatal: " .. tostring(message.message))
        fail_all(message.message)
    elseif kind == "error" then
        -- The server answers in order, so the oldest request for that path failed.
        local request = message.path and take_pending(function(r)
            return r.path == message.path
        end)
        if request then
            request.callback(nil, message.message)
        else
            util.notify(tostring(message.message), vim.log.levels.ERROR)
        end
    else
        local request = take_pending(function(r)
            return r.key == kind and r.path == message.path
        end)
        if request then
            request.callback(message)
        end
    end
end

local function handle_line(line)
    if line == "" then
        return
    end
    local ok, message = pcall(vim.json.decode, line)
    if not ok or type(message) ~= "table" then
        util.debug("unparsable server output: " .. line)
        return
    end
    handle_message(message)
end

local function on_stdout(_, data)
    for index, chunk in ipairs(data) do
        if index == 1 then
            state.partial = state.partial .. chunk
        else
            local line = state.partial
            state.partial = chunk
            handle_line(line)
        end
    end
end

local function on_stderr(_, data)
    for _, line in ipairs(data) do
        if line ~= "" then
            table.insert(state.stderr, line)
            if #state.stderr > MAX_STDERR_LINES then
                table.remove(state.stderr, 1)
            end
            util.debug("server stderr: " .. line)
        end
    end
end

function M.is_running()
    return state.job ~= nil
end

function M.is_ready()
    return state.ready
end

function M.port()
    return state.port
end

function M.token()
    return state.token
end

function M.pid()
    return state.job and vim.fn.jobpid(state.job) or nil
end

-- Starts the server if needed. callback(true) once it is ready, callback(false, message) on failure.
function M.start(callback)
    if state.ready then
        callback(true)
        return
    end
    table.insert(state.waiting, callback)
    if state.job then
        return -- already starting
    end

    local problems = M.check()
    if #problems > 0 then
        fail_all(table.concat(problems, "; "))
        return
    end

    local job
    job = vim.fn.jobstart({ vim.fn.exepath("node"), util.engine_path("server.js") }, {
        env = {
            PREVIEW_THEME = config.options.theme,
            PREVIEW_PORT = tostring(config.options.port),
            PREVIEW_ROOT_MARKERS = vim.json.encode(config.options.root_markers),
            PREVIEW_KROKI_SERVER = config.options.kroki.server,
            PREVIEW_WIKILINKS = tostring(config.options.wikilinks),
        },
        on_stdout = on_stdout,
        on_stderr = on_stderr,
        on_exit = function(_, code)
            if state.job ~= job then
                return -- a server we stopped ourselves, already replaced or forgotten
            end
            local stderr = table.concat(state.stderr, "\n")
            reset()
            local detail = stderr ~= "" and (": " .. stderr) or ""
            fail_all(string.format("preview server exited (code %d)%s", code, detail))
            if M.on_exit then
                M.on_exit(code)
            end
        end,
    })
    if job <= 0 then
        fail_all("could not start node")
        return
    end
    state.job = job
    util.debug(string.format("started server job %d", job))
end

-- Sends a request and calls callback(message) with the answer of type `answer_type`,
-- or callback(nil, error_message) when the server reports an error.
function M.request(message, answer_type, callback)
    if not state.ready then
        callback(nil, "preview server is not running")
        return
    end
    table.insert(state.pending, { key = answer_type, path = message.path, callback = callback })
    vim.fn.chansend(state.job, vim.json.encode(message) .. "\n")
end

-- Marks the server as needed by some work in flight (an export). Returns the function that ends it.
function M.retain()
    state.retained = state.retained + 1
    local released = false
    return function()
        if not released then
            released = true
            state.retained = state.retained - 1
        end
    end
end

-- Stops the server unless something retained it. Used when the last preview closes.
function M.stop_unless_retained()
    if state.retained == 0 then
        M.stop()
    end
end

-- Stops the server. Pending requests are dropped.
function M.stop()
    local job = state.job
    if not job then
        return
    end
    util.debug(string.format("stopping server job %d", job))
    reset()
    state.waiting = {}
    state.pending = {}
    vim.fn.jobstop(job)
end

return M
