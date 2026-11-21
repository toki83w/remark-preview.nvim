local util = require("remark-preview.util")

local M = {}

local INSTALL_HINT = "Run :RemarkPreviewInstallDeps"
local MIN_NODE_MAJOR = 20

-- Files the preview server and the PDF export need.
local ENGINE_FILES = {
    "server.js",
    "preview-server.js",
    "pipeline.js",
    "shell.js",
    "local-diagrams.js",
    "export.js",
    "preview.css",
    "print.css",
    "client/client.js",
    "client/sync.cjs",
    "client/shell.css",
}

-- Packages only needed by the PDF export: the preview works without them.
local OPTIONAL_PACKAGES = { puppeteer = true }

-- Runs a command and returns its trimmed stdout, or nil when it fails.
local function output_of(cmd)
    local ok, result = pcall(function()
        return vim.system(cmd, { text = true }):wait(10000)
    end)
    if not ok or result.code ~= 0 then
        return nil
    end
    return vim.trim(result.stdout)
end

local function check_system()
    vim.health.start("System")

    if vim.fn.has("nvim-0.10") == 1 then
        vim.health.ok("Neovim " .. tostring(vim.version()))
    else
        vim.health.error("Neovim 0.10 or newer is required", "vim.ui.open and vim.system are used")
    end

    if vim.fn.executable("node") ~= 1 then
        vim.health.error("node is missing from PATH", "Install Node.js " .. MIN_NODE_MAJOR .. " or newer")
    else
        local version = output_of({ "node", "--version" })
        local major = version and tonumber(version:match("^v(%d+)"))
        if not major then
            vim.health.warn("could not determine the Node.js version")
        elseif major < MIN_NODE_MAJOR then
            vim.health.error(
                string.format("Node.js %s is too old", version),
                "Node.js " .. MIN_NODE_MAJOR .. " or newer is required"
            )
        else
            vim.health.ok("Node.js " .. version)
        end
    end

    if vim.fn.executable("npm") == 1 then
        vim.health.ok("npm is installed")
    else
        vim.health.error("npm is missing from PATH", "It installs the Node packages")
    end
end

local function check_engine()
    vim.health.start("Preview engine")

    local engine_dir = util.engine_path("")
    if vim.fn.isdirectory(engine_dir) ~= 1 then
        vim.health.error("Engine directory missing: " .. engine_dir)
        return false
    end
    vim.health.ok("Engine directory: " .. engine_dir)

    for _, file in ipairs(ENGINE_FILES) do
        if vim.fn.filereadable(util.engine_path(file)) == 1 then
            vim.health.ok("Found " .. file)
        else
            vim.health.error("Missing " .. file)
        end
    end

    if vim.fn.isdirectory(util.engine_path("node_modules")) ~= 1 then
        vim.health.error("node_modules is missing in preview-engine/", INSTALL_HINT)
        return false
    end
    return true
end

-- The list of packages comes from package.json, so it cannot drift from what is really needed.
local function check_packages()
    vim.health.start("Node packages")

    local lines = vim.fn.readfile(util.engine_path("package.json"))
    local ok, manifest = pcall(vim.json.decode, table.concat(lines, "\n"))
    if not ok or type(manifest.dependencies) ~= "table" then
        vim.health.error("could not read preview-engine/package.json")
        return
    end

    local names = vim.tbl_keys(manifest.dependencies)
    table.sort(names)
    local missing, missing_optional = 0, {}
    for _, name in ipairs(names) do
        if vim.fn.isdirectory(util.engine_path("node_modules/" .. name)) ~= 1 then
            if OPTIONAL_PACKAGES[name] then
                table.insert(missing_optional, name)
            else
                missing = missing + 1
                vim.health.error("Package missing: " .. name, INSTALL_HINT)
            end
        end
    end
    if missing == 0 then
        vim.health.ok(string.format("%d packages installed", #names - #missing_optional))
    end
    for _, name in ipairs(missing_optional) do
        vim.health.warn(name .. " is missing: PDF export is unavailable", INSTALL_HINT)
    end
end

-- Chrome is what puppeteer prints the PDF with.
local function check_export()
    vim.health.start("PDF export")

    if vim.fn.isdirectory(util.engine_path("node_modules/puppeteer")) ~= 1 then
        vim.health.warn("puppeteer is not installed", INSTALL_HINT)
        return
    end
    local script = 'import("puppeteer").then(m => console.log(m.default.executablePath()))'
    -- run from the engine directory so that "puppeteer" resolves
    local ok, result = pcall(function()
        return vim.system({ "node", "-e", script }, { text = true, cwd = util.engine_path("") }):wait(10000)
    end)
    local path = ok and result.code == 0 and vim.trim(result.stdout) or nil
    if path and path ~= "" and vim.fn.executable(path) == 1 then
        vim.health.ok("Chrome for PDF export: " .. path)
    else
        vim.health.warn(
            "no Chrome found for puppeteer: PDF export will fail",
            "Run `npx puppeteer browsers install chrome` in " .. util.engine_path("")
        )
    end
end

-- The tools that can draw diagrams on this machine (see preview-engine/local-diagrams.js).
local LOCAL_DIAGRAM_TOOLS = {
    { type = "mermaid", command = "merman-cli" },
    { type = "plantuml", command = "plantuml" },
}

local function check_diagrams()
    vim.health.start("Diagrams")
    local options = require("remark-preview.config").options

    if not options.local_diagrams then
        vim.health.info("local diagram tools are switched off (local_diagrams = false): every diagram goes to Kroki")
    end
    for _, tool in ipairs(LOCAL_DIAGRAM_TOOLS) do
        local found = vim.fn.exepath(tool.command)
        if options.local_diagrams and found ~= "" then
            vim.health.ok(string.format("%s: drawn locally by %s (%s)", tool.type, tool.command, found))
        elseif found ~= "" then
            vim.health.info(string.format("%s: %s is installed but not used", tool.type, tool.command))
        else
            vim.health.info(
                string.format(
                    "%s: %s not found, drawn by the Kroki server (%s)",
                    tool.type,
                    tool.command,
                    options.kroki.server
                )
            )
        end
    end
    vim.health.info("every other diagram type is drawn by the Kroki server: " .. options.kroki.server)
end

local function check_configuration()
    vim.health.start("Configuration")
    local options = require("remark-preview.config").options
    vim.health.info("theme: " .. options.theme)
    vim.health.info("port: " .. (options.port == 0 and "automatic" or tostring(options.port)))
    vim.health.info("root markers: " .. table.concat(options.root_markers, ", "))
    vim.health.info("wikilinks: " .. tostring(options.wikilinks))
    vim.health.info("Kroki server: " .. options.kroki.server .. " (diagram sources are sent to it)")
    vim.health.info("local diagram tools: " .. tostring(options.local_diagrams))
    vim.health.info("follow the cursor: " .. tostring(options.sync_on_cursor))
end

function M.check()
    vim.health.start("remark-preview.nvim report")
    check_system()
    if check_engine() then
        check_packages()
        check_export()
    end
    check_diagrams()
    check_configuration()
end

return M
