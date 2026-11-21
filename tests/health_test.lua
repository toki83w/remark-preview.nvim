local H = require("helpers")

local tests = {}

-- Runs the health check with vim.health replaced by a recorder; `isdirectory` may be wrapped.
local function run_check(wrap_isdirectory)
    local recorded = { ok = {}, warn = {}, error = {}, info = {}, start = {} }
    local original_health = vim.health
    local original_isdirectory = vim.fn.isdirectory
    vim.health = {}
    for _, kind in ipairs({ "ok", "warn", "error", "info", "start" }) do
        vim.health[kind] = function(message)
            table.insert(recorded[kind], message)
        end
    end
    if wrap_isdirectory then
        vim.fn.isdirectory = wrap_isdirectory(original_isdirectory)
    end
    local ok, err = pcall(function()
        package.loaded["remark-preview.health"] = nil
        require("remark-preview.health").check()
    end)
    vim.health = original_health
    vim.fn.isdirectory = original_isdirectory
    assert(ok, err)
    return recorded
end

local function mentions(list, text)
    return vim.iter(list):any(function(message)
        return message:find(text, 1, true) ~= nil
    end)
end

tests["a complete installation reports no errors"] = function()
    local result = run_check()
    assert(#result.error == 0, vim.inspect(result.error))
    assert(mentions(result.ok, "Node.js"))
    assert(mentions(result.ok, "packages installed"))
    assert(mentions(result.ok, "Found server.js"))
end

tests["the packages checked are the ones listed in package.json"] = function()
    local lines = vim.fn.readfile(vim.fn.getcwd() .. "/preview-engine/package.json")
    local manifest = vim.json.decode(table.concat(lines, "\n"))
    local seen = {}
    local result = run_check(function(original)
        return function(path)
            local name = path:match("node_modules/(.+)$")
            if name then
                seen[name] = true
            end
            return original(path)
        end
    end)
    assert(#result.error == 0)
    for name in pairs(manifest.dependencies) do
        assert(seen[name], name .. " is a dependency but was not checked")
    end
end

tests["a missing package is an error naming the package and the fix"] = function()
    local result = run_check(function(original)
        return function(path)
            if path:find("node_modules/morphdom", 1, true) then
                return 0
            end
            return original(path)
        end
    end)
    assert(mentions(result.error, "Package missing: morphdom"), vim.inspect(result.error))
end

tests["a missing puppeteer only warns: the preview works without it"] = function()
    local result = run_check(function(original)
        return function(path)
            if path:find("node_modules/puppeteer", 1, true) then
                return 0
            end
            return original(path)
        end
    end)
    assert(#result.error == 0, vim.inspect(result.error))
    assert(mentions(result.warn, "puppeteer"), vim.inspect(result.warn))
end

tests["a missing node_modules stops the package checks with one clear error"] = function()
    local result = run_check(function(original)
        return function(path)
            if path:match("preview%-engine/node_modules/?$") then
                return 0
            end
            return original(path)
        end
    end)
    assert(mentions(result.error, "node_modules is missing"), vim.inspect(result.error))
    assert(#result.error == 1, "only the one error: " .. vim.inspect(result.error))
end

tests["the Diagrams section says which tool draws what, and that Kroki is the fallback"] = function()
    local original = vim.fn.exepath
    -- merman-cli is installed, plantuml is not
    vim.fn.exepath = function(command)
        return command == "merman-cli" and "/fake/bin/merman-cli" or ""
    end
    require("remark-preview.config").setup({})
    local ok, result = pcall(run_check)
    vim.fn.exepath = original
    assert(ok, result)
    assert(mentions(result.start, "Diagrams"), vim.inspect(result.start))
    assert(mentions(result.ok, "mermaid: drawn locally by merman-cli (/fake/bin/merman-cli)"), vim.inspect(result.ok))
    assert(mentions(result.info, "plantuml: plantuml not found, drawn by the Kroki server"), vim.inspect(result.info))
    assert(#result.error == 0, vim.inspect(result.error))
    H.restore()
end

tests["with local_diagrams off the tools are reported as unused"] = function()
    local original = vim.fn.exepath
    vim.fn.exepath = function(command)
        return "/fake/bin/" .. command
    end
    require("remark-preview.config").setup({ local_diagrams = false })
    local ok, result = pcall(run_check)
    vim.fn.exepath = original
    assert(ok, result)
    assert(mentions(result.info, "switched off"), vim.inspect(result.info))
    assert(mentions(result.info, "merman-cli is installed but not used"), vim.inspect(result.info))
    assert(not mentions(result.ok, "drawn locally"), vim.inspect(result.ok))
    H.restore()
end

tests["the configuration is shown"] = function()
    require("remark-preview.config").setup({ theme = "light" })
    local result = run_check()
    assert(mentions(result.info, "theme: light"))
    assert(mentions(result.info, "Kroki server: https://kroki.io"))
    assert(mentions(result.info, "local diagram tools: true"))
    H.restore()
end

return tests
