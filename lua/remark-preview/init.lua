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
        if vim.fn.executable(bin) ~= 1 then table.insert(missing, bin) end
    end
    return missing
end

function M.install_deps()
    local pkgs = { 
        "remark-cli", "remark-parse", "remark-gfm", "remark-github-alerts",
        "remark-math", "remark-asciimath", "remark-kroki", "remark-rehype", 
        "rehype-katex", "rehype-document", "rehype-stringify", "live-server" 
    }
    local cmd = "npm install -g " .. table.concat(pkgs, " ")
    vim.notify("remark-preview: Installing dependencies...", vim.log.levels.INFO)
    vim.cmd("split | term " .. cmd)
end

function M.build()
    local pkgs = { 
        "remark-cli", "remark-parse", "remark-gfm", "remark-github-alerts",
        "remark-math", "remark-asciimath", "remark-kroki", "remark-rehype", 
        "rehype-katex", "rehype-document", "rehype-stringify", "live-server" 
    }
    local cmd = "npm install -g " .. table.concat(pkgs, " ")
    print("Building remark-preview...")
    local result = os.execute(cmd)
    if result ~= 0 then error("Build failed. Check npm permissions.") end
end

local function run_remark(input, output)
    local remark_config = get_plugin_path("remarkrc.js")
    local doc_dir = vim.fn.expand("%:p:h")
    
    local cmd = string.format("remark %s --rc-path %s --output %s", 
        vim.fn.shellescape(input), vim.fn.shellescape(remark_config), vim.fn.shellescape(output))
        
    vim.fn.jobstart(cmd, {
        env = { 
            PREVIEW_THEME = M.config.theme,
            PLUGIN_PATH = vim.fn.fnamemodify(get_plugin_path(""), ":h"),
            DOC_DIR = doc_dir
        },
        on_exit = function(_, exit_code)
            if exit_code ~= 0 then
                -- Generate a styled error page if the remark engine crashes
                local f = io.open(output, "w")
                if f then
                    local error_html = string.format([[
<!DOCTYPE html>
<html>
<head>
    <title>Remark Preview Error</title>
    <style>
        body { font-family: -apple-system, sans-serif; background: #1e1e2e; color: #f38ba8; padding: 50px; line-height: 1.6; }
        .box { border: 2px solid #f38ba8; padding: 30px; border-radius: 12px; background: #181825; max-width: 800px; margin: 0 auto; }
        h1 { margin-top: 0; display: flex; align-items: center; gap: 10px; }
        code { background: #313244; padding: 2px 6px; border-radius: 4px; color: #fab387; }
        p { color: #cdd6f4; }
        .footer { margin-top: 20px; font-size: 0.8em; color: #6c7086; border-top: 1px solid #313244; padding-top: 10px; }
    </style>
</
