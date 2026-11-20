local H = require("helpers")

local root = vim.fn.fnamemodify(debug.getinfo(1).source:sub(2), ":p:h:h")
local script = root .. "/examples/preview.sh"

local tests = {}

-- A stand-in for nvim: the real one, headless, which records what the preview did (the browser it
-- would have opened, the messages shown), prints that as one JSON line and quits.
local function stand_in(dir)
    local check = dir .. "/check.lua"
    H.write(check, {
        'local session = require("remark-preview.session")',
        'local config = require("remark-preview.config")',
        "local buf = vim.api.nvim_get_current_buf()",
        "vim.wait(20000, function()",
        "    local s = session.get(buf)",
        "    return s and s.url",
        "end, 20)",
        "local s = session.get(buf)",
        "io.stdout:write(vim.json.encode({",
        "    url = s and s.url,",
        "    name = vim.api.nvim_buf_get_name(buf),",
        "    theme = config.options.theme,",
        "    follow = config.options.sync_on_cursor,",
        "    opened = _G.__opened,",
        "    notes = _G.__notes,",
        "    user_config = vim.g.user_config_loaded,",
        '    server_pid = require("remark-preview.server").pid(),',
        '}) .. "\\n")',
        'vim.cmd("qa!")',
    })
    local prep = dir .. "/prep.lua"
    H.write(prep, {
        "_G.__opened, _G.__notes = {}, {}",
        "vim.ui.open = function(url)",
        "    table.insert(_G.__opened, url)",
        "    return {}, nil",
        "end",
        "vim.notify = function(msg)",
        "    table.insert(_G.__notes, msg)",
        "end",
        'vim.api.nvim_create_autocmd("VimEnter", {',
        "    once = true,",
        "    callback = function()",
        "        vim.defer_fn(function()",
        string.format("            dofile(%q)", check),
        "        end, 50)",
        "    end,",
        "})",
    })
    local path = dir .. "/fake-nvim"
    H.write(path, { "#!/bin/bash", string.format('exec nvim --headless -c "luafile %s" "$@"', prep) })
    vim.uv.fs_chmod(path, tonumber("755", 8))
    return path
end

-- Runs the script with the stand-in; returns the process result and the decoded report.
local function launch(args, opts)
    opts = opts or {}
    local dir = H.tmpdir()
    -- a user configuration that must not be loaded
    vim.fn.mkdir(dir .. "/xdg/nvim", "p")
    H.write(dir .. "/xdg/nvim/init.lua", { "vim.g.user_config_loaded = true" })
    local env = { NVIM = stand_in(dir), XDG_CONFIG_HOME = dir .. "/xdg" }
    local result = vim.system(vim.list_extend({ script }, args), { text = true, env = env }):wait(60000)
    local report
    for line in (result.stdout or ""):gmatch("[^\n]+") do
        if line:sub(1, 1) == "{" then
            report = vim.json.decode(line)
        end
    end
    return result, report, dir
end

tests["opens the reference document and the preview in the browser"] = function()
    local result, report = launch({})
    assert(result.code == 0, "exit " .. result.code .. ": " .. (result.stderr or ""))
    assert(report, "no report: " .. (result.stdout or ""))
    assert(report.name == root .. "/examples/vault/features.md", report.name)
    assert(report.url and report.url:match("^http://127%.0%.0%.1:%d+/d/%x+/%?t=%x+$"), tostring(report.url))
    assert(
        #report.opened == 1 and report.opened[1] == report.url,
        "the browser must be opened once with the preview URL"
    )
    assert(report.theme == "dark" and report.follow == false)
end

tests["the preview server stops when Neovim quits"] = function()
    local _, report = launch({})
    assert(report and report.server_pid, "no server pid reported")
    H.wait(function()
        return not H.alive(report.server_pid)
    end, 5000, "the server outlived Neovim")
end

tests["the user's own configuration is not loaded"] = function()
    local _, report = launch({})
    assert(report.user_config == nil, "the configuration of the user was loaded")
end

tests["--theme and --follow reach the plugin"] = function()
    local _, report = launch({ "--theme", "light", "--follow" })
    assert(report.theme == "light" and report.follow == true, vim.inspect(report))
    local _, short = launch({ "-t", "dark", "-f" })
    assert(short.theme == "dark" and short.follow == true)
    local _, equals = launch({ "--theme=light" })
    assert(equals.theme == "light")
end

tests["--no-browser shows the URL instead of opening a browser"] = function()
    local result, report = launch({ "--no-browser" })
    assert(result.code == 0 and report)
    assert(#report.opened == 0, "no browser must be opened")
    local shown = false
    for _, note in ipairs(report.notes) do
        shown = shown or note:find(report.url, 1, true) ~= nil
    end
    assert(shown, "the URL must be shown: " .. vim.inspect(report.notes))
end

tests["another file can be given, also one with spaces in its path"] = function()
    local dir = H.tmpdir()
    vim.fn.mkdir(dir .. "/with space", "p")
    H.write(dir .. "/with space/my note.md", { "# My note" })
    local result, report = launch({ dir .. "/with space/my note.md" })
    assert(result.code == 0 and report, result.stderr)
    assert(report.name == dir .. "/with space/my note.md", report.name)
    assert(report.url, "the preview did not start")
end

tests["a file whose name starts with a dash is not taken for an option"] = function()
    local dir = H.tmpdir()
    H.write(dir .. "/-odd.md", { "# Odd" })
    local result, report = launch({ "--", dir .. "/-odd.md" })
    assert(result.code == 0 and report, result.stderr)
    assert(report.name == dir .. "/-odd.md")
end

tests["mistakes in the command line are reported and nothing is started"] = function()
    local cases = {
        { { "--theme", "blue" }, "unknown theme" },
        { { "--theme" }, "needs a value" },
        { { "--bogus" }, "unknown option" },
        { { "a.md", "b.md" }, "only one file" },
        { { "/nonexistent/x.md" }, "no such file" },
    }
    for _, case in ipairs(cases) do
        local result, report = launch(case[1])
        assert(result.code == 1, table.concat(case[1], " ") .. " must fail")
        assert(report == nil, "nothing may be started")
        assert(
            (result.stderr or ""):find(case[2], 1, true),
            table.concat(case[1], " ") .. ": " .. (result.stderr or "")
        )
    end
end

tests["--help prints the usage and exits cleanly"] = function()
    local result = vim.system({ script, "--help" }, { text = true }):wait(10000)
    assert(result.code == 0)
    assert(result.stdout:find("Usage: examples/preview.sh", 1, true))
    assert(result.stdout:find("--no-browser", 1, true))
end

tests["missing npm dependencies are explained, with the command that fixes them"] = function()
    -- a copy of the examples without the engine's node_modules, like a fresh checkout
    local dir = H.tmpdir()
    vim.fn.mkdir(dir .. "/examples", "p")
    vim.fn.mkdir(dir .. "/preview-engine", "p")
    vim.fn.system({ "cp", script, dir .. "/examples/preview.sh" })
    H.write(dir .. "/doc.md", { "# Doc" })
    local result = vim.system({ dir .. "/examples/preview.sh", dir .. "/doc.md" }, { text = true }):wait(10000)
    assert(result.code == 1)
    assert(result.stderr:find("npm dependencies are missing", 1, true), result.stderr)
    assert(result.stderr:find("npm install --prefix", 1, true), result.stderr)
end

tests["a missing Neovim is explained"] = function()
    local result = vim.system({ script }, { text = true, env = { NVIM = "/nonexistent/nvim" } }):wait(10000)
    assert(result.code == 1)
    assert(result.stderr:find("Neovim not found", 1, true), result.stderr)
end

return tests
