local M = {}

local server_job_id = nil
local is_windows = vim.fn.has("win32") == 1 or vim.fn.has("win64") == 1
local temp_dir = is_windows and os.getenv("TEMP") or (os.getenv("TMPDIR") or "/tmp")

M.config = {
    theme = "dark",
    port_base = 8080,
}

local REQUIRED_BINS = { "node", "npm", "remark", "live-server" }

local function get_plugin_path(file)
    local plugin_root = vim.fn.fnamemodify(debug.getinfo(1).source:sub(2), ":h:h:h")
    return vim.fs.joinpath(plugin_root, "templates", file)
end

local function get_paths()
    local name = vim.fn.expand("%:t:r")
    local pid = vim.fn.getpid()
    local unique_name = string.format("%s_%d", name, pid)
    return vim.fn.expand("%:p"),
        vim.fs.joinpath(temp_dir, unique_name .. ".html"),
        unique_name .. ".html",
        vim.fs.joinpath(temp_dir, "scroll_" .. pid .. ".json")
end

local function check_dependencies()
    local missing = {}
    for _, bin in ipairs(REQUIRED_BINS) do
        if vim.fn.executable(bin) ~= 1 then
            table.insert(missing, bin)
        end
    end
    return missing
end

function M.install_deps()
    local pkgs = {
        "remark-cli",
        "remark-parse",
        "remark-gfm",
        "remark-github-alerts",
        "remark-math",
        "remark-asciimath",
        "remark-kroki",
        "remark-rehype",
        "rehype-katex",
        "rehype-document",
        "rehype-stringify",
        "live-server",
    }
    local cmd = "npm install -g " .. table.concat(pkgs, " ")
    vim.notify("remark-preview: Installing dependencies...", vim.log.levels.INFO)
    vim.cmd("split | term " .. cmd)
end

function M.build()
    local pkgs = {
        "remark-cli",
        "remark-parse",
        "remark-gfm",
        "remark-github-alerts",
        "remark-math",
        "remark-asciimath",
        "remark-kroki",
        "remark-rehype",
        "rehype-katex",
        "rehype-document",
        "rehype-stringify",
        "live-server",
    }
    local cmd = "npm install -g " .. table.concat(pkgs, " ")
    print("Building remark-preview...")
    local result = os.execute(cmd)
    if result ~= 0 then
        error("Build failed. Check npm permissions.")
    end
end

local function run_remark(input, output)
    local remark_config = get_plugin_path("remarkrc.js")
    local cmd = string.format(
        "remark %s --rc-path %s --output %s",
        vim.fn.shellescape(input),
        vim.fn.shellescape(remark_config),
        vim.fn.shellescape(output)
    )

    vim.fn.jobstart(cmd, {
        env = {
            PREVIEW_THEME = M.config.theme,
            PLUGIN_PATH = vim.fn.fnamemodify(get_plugin_path(""), ":h"),
        },
    })
end

function M.toggle()
    vim.g.markdown_preview_active = not vim.g.markdown_preview_active
    local _, output_path, html_filename, _ = get_paths()
    local port = M.config.port_base + (vim.fn.getpid() % 1000)

    if vim.g.markdown_preview_active then
        if not server_job_id then
            server_job_id = vim.fn.jobstart(
                string.format("live-server %s --port=%d --no-browser", vim.fn.shellescape(temp_dir), port)
            )
        end
        run_remark(vim.fn.expand("%:p"), output_path)
        local opener = is_windows and 'start "" ' or "xdg-open "
        vim.fn.jobstart(opener .. string.format("http://127.0.0.1:%d/%s", port, html_filename), { shell = is_windows })
    else
        if server_job_id then
            vim.fn.jobstop(server_job_id)
        end
        server_job_id = nil
        vim.g.markdown_preview_active = false
    end
end

function M.setup(opts)
    M.config = vim.tbl_deep_extend("force", M.config, opts or {})
    vim.api.nvim_create_user_command("RemarkPreviewToggle", M.toggle, {})
    vim.api.nvim_create_user_command("RemarkPreviewInstall", M.install_deps, {})

    local missing = check_dependencies()
    if #missing > 0 then
        vim.schedule(function()
            vim.notify(
                "remark-preview: Missing " .. table.concat(missing, ", ") .. ". Run :RemarkPreviewInstall",
                vim.log.levels.WARN
            )
        end)
    end

    local group = vim.api.nvim_create_augroup("RemarkPreview", { clear = true })
    vim.api.nvim_create_autocmd("BufWritePost", {
        group = group,
        pattern = "*.md",
        callback = function()
            if vim.g.markdown_preview_active then
                local input, output = get_paths()
                run_remark(input, output)
            end
        end,
    })
    vim.api.nvim_create_autocmd({ "CursorMoved", "CursorMovedI" }, {
        group = group,
        pattern = "*.md",
        callback = function()
            if vim.g.markdown_preview_active then
                local _, _, _, scroll_path = get_paths()
                local f = io.open(scroll_path, "w")
                if f then
                    f:write(string.format('{"percent": %f}', vim.fn.line(".") / vim.fn.line("$")))
                    f:close()
                end
            end
        end,
    })
end

return M
