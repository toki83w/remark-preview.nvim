local M = {}

local server_job_id = nil
local is_windows = vim.fn.has("win32") == 1 or vim.fn.has("win64") == 1
local temp_dir = is_windows and os.getenv("TEMP") or (os.getenv("TMPDIR") or "/tmp")

M.config = {
    theme = "dark",
    port_base = 8080,
    pdf = {
        format = "A4",
        margin = "1cm",
    },
}

-- Helper to get the absolute path to the plugin root
local function get_plugin_path()
    -- Gets the root path of the plugin
    return vim.fn.fnamemodify(debug.getinfo(1).source:sub(2), ":h:h:h")
end

local function get_engine_path(file)
    return vim.fs.joinpath(get_plugin_path(), "preview-engine", file)
end

local remark_bin = get_engine_path("node_modules/.bin/remark")
local server_bin = get_engine_path("node_modules/.bin/live-server")

local REQUIRED_BINS = { "node", "npm", remark_bin, server_bin }

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
    local path = get_engine_path("")
    local cmd = "cd " .. vim.fn.shellescape(path) .. " && npm install"

    vim.notify("remark-preview: Installing dependencies in " .. path, vim.log.levels.INFO)

    -- Run in a terminal split so the user can see progress
    vim.cmd("split | term " .. cmd)
end

local function run_remark(input, output, theme_override)
    local remark_config = get_engine_path("remarkrc.js")
    local doc_dir = vim.fn.expand("%:p:h")
    local active_theme = theme_override or M.config.theme

    local cmd = string.format(
        "%s %s --rc-path %s --output %s",
        remark_bin,
        vim.fn.shellescape(input),
        vim.fn.shellescape(remark_config),
        vim.fn.shellescape(output)
    )

    vim.fn.jobstart(cmd, {
        env = {
            PREVIEW_THEME = active_theme,
            ENGINE_PATH = get_engine_path(""),
            DOC_DIR = doc_dir,
        },
        on_exit = function(_, exit_code)
            if exit_code ~= 0 then
                local f = io.open(output, "w")
                if f then
                    local error_html = string.format(
                        [[
<!DOCTYPE html><html><head><style>body{font-family:sans-serif;background:#1e1e2e;color:#f38ba8;padding:50px;}.box{border:2px solid #f38ba8;padding:20px;background:#181825;}</style></head>
<body><div class="box"><h1>⚠️ Rendering Error</h1><p>Check syntax or Kroki connection.</p><p>Exit Code: %d</p></div></body></html>]],
                        exit_code
                    )
                    f:write(error_html)
                    f:close()
                end
            end
        end,
    })
end

function M.export_pdf(open_after)
    local input = vim.fn.expand("%:p")
    local output_pdf = vim.fn.expand("%:p:r") .. ".pdf"
    local temp_html = vim.fs.joinpath(temp_dir, "export_temp.html")
    local export_script = get_engine_path("export.js")

    vim.notify("Exporting to PDF (Print Theme)...", vim.log.levels.INFO)
    run_remark(input, temp_html, "print")

    vim.defer_fn(function()
        local cmd = string.format(
            "node %s %s %s",
            vim.fn.shellescape(export_script),
            vim.fn.shellescape(temp_html),
            vim.fn.shellescape(output_pdf)
        )
        vim.fn.jobstart(cmd, {
            env = {
                PDF_FORMAT = M.config.pdf.format,
                PDF_MARGIN = M.config.pdf.margin,
            },
            on_exit = function(_, exit_code)
                if exit_code == 0 then
                    vim.notify("PDF saved: " .. output_pdf)
                    if open_after then
                        local opener = is_windows and 'start "" ' or "xdg-open "
                        vim.fn.jobstart(opener .. vim.fn.shellescape(output_pdf), { detach = true, shell = is_windows })
                    end
                else
                    vim.notify("Export failed. Run :RemarkPreviewInstall", vim.log.levels.ERROR)
                end
            end,
        })
    end, 1500)
end

local function compute_port()
    return M.config.port_base + (vim.fn.getpid() % 1000)
end

local function start_server(port)
    if not server_job_id then
        server_job_id = vim.fn.jobstart(
            string.format("%s %s --port=%d --no-browser", server_bin, vim.fn.shellescape(temp_dir), port)
        )
    end
end

local function stop_server()
    if server_job_id then
        vim.fn.jobstop(server_job_id)
        server_job_id = nil
    end
end

local function open_preview(port, html_filename)
    local opener = is_windows and 'start "" ' or "xdg-open "
    vim.fn.jobstart(opener .. string.format("http://127.0.0.1:%d/%s", port, html_filename), { shell = is_windows })
end

function M.toggle()
    vim.g.markdown_preview_active = not vim.g.markdown_preview_active
    local _, output_path, html_filename, _ = get_paths()
    local port = compute_port()

    if vim.g.markdown_preview_active then
        start_server(port)
        run_remark(vim.fn.expand("%:p"), output_path)
        open_preview(port, html_filename)
    else
        stop_server()
    end
end

function M.open()
    if not vim.g.markdown_preview_active then
        M.toggle()
        return
    end

    local _, _, html_filename, _ = get_paths()
    local port = compute_port()

    open_preview(port, html_filename)
end

function M.restart()
    if vim.g.markdown_preview_active then
        M.toggle()
    end
    M.toggle()
end

function M.sync_preview()
    if not vim.g.markdown_preview_active then
        return
    end
    local _, _, _, scroll_path = get_paths()
    local f = io.open(scroll_path, "w")
    if f then
        local percent = vim.fn.line(".") / vim.fn.line("$")
        -- Use a timestamp to signal a new "on-demand" sync event
        f:write(string.format('{"percent": %f, "ts": %d}', percent, os.time()))
        f:close()
    end
end

function M.setup(opts)
    M.config = vim.tbl_deep_extend("force", M.config, opts or {})
    vim.api.nvim_create_user_command("RemarkPreviewInstall", M.install_deps, {})
    vim.api.nvim_create_user_command("RemarkPreviewOpen", M.open, {})
    vim.api.nvim_create_user_command("RemarkPreviewToggle", M.toggle, {})
    vim.api.nvim_create_user_command("RemarkPreviewRestart", M.restart, {})

    vim.api.nvim_create_user_command("RemarkPreviewSyncPosition", M.sync_preview, {})

    vim.api.nvim_create_user_command("RemarkPreviewExport", function(cmd_opts)
        M.export_pdf(cmd_opts.args == "open")
    end, { nargs = "?" })

    local missing = check_dependencies()
    if #missing > 0 then
        vim.schedule(function()
            vim.notify("remark-preview: Missing deps. Run :RemarkPreviewInstall", vim.log.levels.WARN)
        end)
    end

    local group = vim.api.nvim_create_augroup("RemarkPreview", { clear = true })

    -- Regenerate preview on save
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
end

return M
