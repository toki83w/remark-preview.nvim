local M = {}

-- Helper to get the absolute path to the plugin root
local function get_plugin_path()
    return vim.fn.fnamemodify(debug.getinfo(1).source:sub(2), ":h:h:h")
end

-- Helper to get paths relative to the preview-engine folder
local function get_engine_path(file)
    return vim.fs.joinpath(get_plugin_path(), "preview-engine", file)
end

function M.check()
    vim.health.start("remark-preview.nvim report")

    -- 1. Check System Prerequisites
    vim.health.info("Checking System Binaries...")
    local sys_bins = { "node", "npm" }
    for _, bin in ipairs(sys_bins) do
        if vim.fn.executable(bin) == 1 then
            vim.health.ok(bin .. " is installed")
        else
            vim.health.error(bin .. " is missing from PATH")
        end
    end

    -- 2. Check Plugin Engine State
    vim.health.info("Checking Plugin Engine...")
    local engine_dir = get_engine_path("")
    local node_modules = get_engine_path("node_modules")

    if vim.fn.isdirectory(engine_dir) == 1 then
        vim.health.ok("Engine directory exists: " .. engine_dir)
    else
        vim.health.error("Engine directory missing: " .. engine_dir)
    end

    if vim.fn.isdirectory(node_modules) == 1 then
        vim.health.ok("Local node_modules exist")
    else
        vim.health.error("node_modules missing in preview-engine/", "Run :RemarkPreviewInstall")
        return
    end

    -- 3. Check Required NPM Packages
    vim.health.info("Checking NPM Packages...")
    local required_pkgs = {
        "@widcardw/rehype-asciimath",
        "live-server",
        "puppeteer",
        "rehype-callouts",
        "rehype-document",
        "rehype-highlight",
        "rehype-katex",
        "rehype-slug",
        "rehype-stringify",
        "remark-cli",
        "remark-flexible-toc",
        "remark-frontmatter",
        "remark-gfm",
        "remark-kroki",
        "remark-mark-highlight",
        "remark-math",
        "remark-parse",
        "remark-rehype",
    }

    for _, pkg in ipairs(required_pkgs) do
        local pkg_path = get_engine_path(vim.fs.joinpath("node_modules", pkg))
        if vim.fn.isdirectory(pkg_path) == 1 then
            vim.health.ok("Package installed: " .. pkg)
        else
            vim.health.error("Package missing: " .. pkg, "Run :RemarkPreviewInstall")
        end
    end

    -- 4. Check Local Binaries
    vim.health.info("Checking Engine Binaries...")
    local local_bins = {
        remark = get_engine_path("node_modules/.bin/remark"),
        ["live-server"] = get_engine_path("node_modules/.bin/live-server"),
    }

    for name, path in pairs(local_bins) do
        if vim.fn.executable(path) == 1 then
            vim.health.ok("Local binary found: " .. name)
        else
            vim.health.error("Local binary missing: " .. name, "Run :RemarkPreviewInstall")
        end
    end

    -- 5. Check Asset Files
    vim.health.info("Checking Asset Files...")
    local asset_files = {
        "remarkrc.js",
        "export.js",
        "preview.css",
        "print.css",
    }

    for _, f in ipairs(asset_files) do
        local p = get_engine_path(f)
        if vim.fn.filereadable(p) == 1 then
            vim.health.ok("Found asset: " .. f)
        else
            vim.health.error("Missing asset: " .. f)
        end
    end
end

return M
