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

return M
