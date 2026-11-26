local M = {}

M.defaults = {
    theme = "dark", -- "dark" (Mocha) or "light" (Latte)
    port = 0, -- 0 lets the OS choose a free port for the preview server
    debug = false, -- print debug messages
    sync_on_cursor = false, -- scroll the preview along with the cursor (otherwise: :RemarkPreviewSyncPosition)
    -- How the preview URL is opened. nil: the system handler (vim.ui.open). A command, with the URL
    -- appended as the last argument, e.g. { "firefox", "--new-window" }; or a function(url).
    browser_command = nil,
    -- A document's project root is its nearest ancestor containing one of these (else its own
    -- directory). Images and linked files are only served from inside it.
    root_markers = { ".obsidian", ".git" },
    -- Obsidian [[wikilinks]] and ![[embeds]]: "auto" turns them on inside a vault (a project root
    -- containing .obsidian), true always, false never.
    wikilinks = "auto",
    kroki = {
        -- Diagrams (mermaid, plantuml, graphviz, ...) are drawn by a Kroki server. The source of every
        -- diagram is sent to it: point this at a self-hosted instance to keep your documents private.
        server = "https://kroki.io",
    },
    -- Use the diagram tools installed on this machine when they are found on the PATH: `merman-cli`
    -- draws mermaid and `plantuml` draws plantuml, so those sources stay local and need no internet.
    -- Every other diagram type, and any type whose tool is missing, goes to the Kroki server.
    -- false: always Kroki.
    local_diagrams = true,
    pdf = {
        format = "A4",
        margin = "1cm",
    },
}

M.options = vim.deepcopy(M.defaults)

local THEMES = { dark = true, light = true, ["github-dark"] = true, ["github-light"] = true }

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

    merged.sync_on_cursor = merged.sync_on_cursor == true

    -- a command given by the user replaces the default instead of being merged index by index
    if opts.browser_command ~= nil then
        merged.browser_command = type(opts.browser_command) == "table" and vim.deepcopy(opts.browser_command)
            or opts.browser_command
    end
    local command = merged.browser_command
    local command_valid = command == nil
        or type(command) == "function"
        or (
            vim.islist(command)
            and #command > 0
            and vim.iter(command):all(function(arg)
                return type(arg) == "string" and arg ~= ""
            end)
        )
    if not command_valid then
        vim.schedule(function()
            vim.notify(
                "remark-preview: `browser_command` must be a list of strings or a function, using the system handler",
                vim.log.levels.WARN
            )
        end)
        merged.browser_command = nil
    end

    if type(merged.local_diagrams) ~= "boolean" then
        vim.schedule(function()
            vim.notify("remark-preview: `local_diagrams` must be true or false, using true", vim.log.levels.WARN)
        end)
        merged.local_diagrams = true
    end

    if merged.wikilinks ~= "auto" and type(merged.wikilinks) ~= "boolean" then
        vim.schedule(function()
            vim.notify('remark-preview: `wikilinks` must be "auto", true or false, using "auto"', vim.log.levels.WARN)
        end)
        merged.wikilinks = "auto"
    end

    local kroki_server = type(merged.kroki) == "table" and merged.kroki.server or nil
    if type(kroki_server) ~= "string" or not kroki_server:match("^https?://[^%s]+$") then
        vim.schedule(function()
            vim.notify(
                "remark-preview: `kroki.server` must be an http(s) URL, using " .. M.defaults.kroki.server,
                vim.log.levels.WARN
            )
        end)
        merged.kroki = vim.deepcopy(M.defaults.kroki)
    end

    -- a list given by the user replaces the default instead of being merged index by index
    if opts.root_markers ~= nil then
        merged.root_markers = vim.deepcopy(opts.root_markers)
    end
    local markers_valid = vim.islist(merged.root_markers)
        and vim.iter(merged.root_markers):all(function(marker)
            return type(marker) == "string" and marker ~= ""
        end)
    if not markers_valid then
        vim.schedule(function()
            vim.notify("remark-preview: invalid `root_markers`, using the defaults", vim.log.levels.WARN)
        end)
        merged.root_markers = vim.deepcopy(M.defaults.root_markers)
    end

    M.options = merged
    return M.options
end

return M
