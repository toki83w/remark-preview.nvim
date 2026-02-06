local M = {}

local function check_npm_pkg(pkg)
    local handle = io.popen("npm list -g " .. pkg .. " --depth=0")
    local result = handle:read("*a")
    handle:close()

    if result:find(pkg) then
        vim.health.ok(pkg .. " is installed")
    else
        vim.health.error(pkg .. " is missing", "Run: npm install -g " .. pkg)
    end
end

function M.check()
    vim.health.start("remark-preview dependencies")

    -- Check Binaries
    if vim.fn.executable("node") == 1 then
        vim.health.ok("node is installed")
    else
        vim.health.error("node is not in PATH")
    end

    if vim.fn.executable("npm") == 1 then
        vim.health.ok("npm is installed")
    else
        vim.health.error("npm is not in PATH")
    end

    -- Check Specific Packages
    local pkgs = {
        "remark-cli",
        "remark-parse",
        "remark-gfm",
        "remark-rehype",
        "rehype-document",
        "rehype-stringify",
        "live-server",
    }

    for _, pkg in ipairs(pkgs) do
        check_npm_pkg(pkg)
    end
end

return M
