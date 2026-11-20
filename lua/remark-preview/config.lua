local M = {}

M.defaults = {
    theme = "dark", -- "dark" (Mocha) or "light" (Latte)
    port = 0, -- 0 lets the OS choose a free port for the preview server
    debug = false, -- print debug messages
    pdf = {
        format = "A4",
        margin = "1cm",
    },
}

M.options = vim.deepcopy(M.defaults)

local THEMES = { dark = true, light = true }

function M.setup(opts)
    opts = vim.deepcopy(opts or {})

    if opts.port_base ~= nil then
        vim.schedule(function()
            vim.notify(
                "remark-preview: `port_base` is deprecated and ignored (the server now picks a free port). "
                    .. "Use `port` to force a specific port.",
                vim.log.levels.WARN
            )
        end)
        opts.port_base = nil
    end

    local merged = vim.tbl_deep_extend("force", M.defaults, opts)

    if not THEMES[merged.theme] then
        local unknown = tostring(merged.theme)
        vim.schedule(function()
            vim.notify(string.format('remark-preview: unknown theme "%s", using "dark"', unknown), vim.log.levels.WARN)
        end)
        merged.theme = "dark"
    end
    if type(merged.port) ~= "number" or merged.port < 0 or merged.port > 65535 then
        vim.schedule(function()
            vim.notify("remark-preview: invalid `port`, using a free port", vim.log.levels.WARN)
        end)
        merged.port = 0
    end

    M.options = merged
    return M.options
end

return M
