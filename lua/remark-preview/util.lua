local M = {}

-- Absolute path of the plugin root (the directory containing lua/ and preview-engine/).
local function get_plugin_path()
    return vim.fn.fnamemodify(debug.getinfo(1).source:sub(2), ":h:h:h")
end

function M.engine_path(file)
    return vim.fs.joinpath(get_plugin_path(), "preview-engine", file)
end

function M.notify(msg, level)
    vim.notify("remark-preview: " .. msg, level or vim.log.levels.INFO)
end

-- Only printed when `debug = true` in the configuration.
function M.debug(msg)
    if require("remark-preview.config").options.debug then
        vim.notify("remark-preview [debug]: " .. msg, vim.log.levels.DEBUG)
    end
end

-- Absolute path of a buffer's file, or nil when the buffer is not backed by a file name.
function M.buffer_path(bufnr)
    local name = vim.api.nvim_buf_get_name(bufnr)
    if name == "" then
        return nil
    end
    return vim.fn.fnamemodify(name, ":p")
end

-- Opens a URL or file with the system handler. Falls back to showing the URL.
function M.open_external(target)
    local cmd, err = vim.ui.open(target)
    if not cmd then
        M.notify(string.format("could not open %s (%s)", target, err or "no opener found"), vim.log.levels.WARN)
    end
end

-- Opens the URL of a preview: with `browser_command` when it is set, else with the system handler.
function M.open_preview(url)
    local command = require("remark-preview.config").options.browser_command
    if type(command) == "function" then
        local ok, err = pcall(command, url)
        if not ok then
            M.notify("browser_command failed: " .. tostring(err), vim.log.levels.WARN)
        end
    elseif command then
        local args = vim.list_extend(vim.deepcopy(command), { url })
        if vim.fn.executable(args[1]) ~= 1 then
            M.notify(string.format("browser_command: %s is not executable", args[1]), vim.log.levels.WARN)
            return
        end
        local ok, err = pcall(vim.system, args, { detach = true })
        if not ok then
            M.notify("browser_command failed: " .. tostring(err), vim.log.levels.WARN)
        end
    else
        M.open_external(url)
    end
end

return M
