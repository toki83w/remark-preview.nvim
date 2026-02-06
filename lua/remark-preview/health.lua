local M = {}

local function check_npm_pkg(pkg)
    local cmd = vim.fn.has("win32") == 1 and "npm list -g " or "npm list -g --depth=0 "
    local handle = io.popen(cmd .. pkg)
    local result = handle:read("*a")
    handle:close()
    if result:find(pkg) then
        vim.health.ok(pkg .. " is installed")
    else
        vim.health.error(pkg .. " is missing", "Run: :RemarkPreviewInstall")
    end
end

function M.check()
    vim.health.start("remark-preview dependencies")
    local bins = { "node", "npm", "remark", "live-server" }
    for _, bin in ipairs(bins) do
        if vim.fn.executable(bin) == 1 then
            vim.health.ok(bin .. " is installed")
        else
            vim.health.error(bin .. " is not in PATH")
        end
    end

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
    }
    for _, pkg in ipairs(pkgs) do
        check_npm_pkg(pkg)
    end
end

return M
