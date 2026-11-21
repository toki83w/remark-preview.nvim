local H = require("helpers")

local root = vim.fn.fnamemodify(debug.getinfo(1).source:sub(2), ":p:h:h")
local script = root .. "/examples/export.sh"

local tests = {}

-- Runs the script from a fresh working directory; returns the process result and that directory.
local function export(args, opts)
    opts = opts or {}
    local dir = H.tmpdir()
    local result = vim.system(vim.list_extend({ script }, args), { text = true, cwd = dir, env = opts.env })
        :wait(120000)
    return result, dir
end

local function is_pdf(path)
    local stat = vim.uv.fs_stat(path)
    if not stat or stat.size < 1000 then
        return false
    end
    return vim.fn.readfile(path, "b", 1)[1]:sub(1, 5) == "%PDF-"
end

tests["exports the reference document into the current directory"] = function()
    local result, dir = export({})
    assert(result.code == 0, "exit " .. result.code .. ": " .. (result.stderr or ""))
    assert(is_pdf(dir .. "/features.pdf"), "no PDF: " .. (result.stdout or ""))
    assert(vim.trim(result.stdout):find(dir .. "/features.pdf", 1, true), "the path must be printed: " .. result.stdout)
    assert(vim.fn.filereadable(root .. "/examples/vault/features.pdf") == 0, "nothing may be written into the vault")
end

tests["--output chooses the file, and --local-diagrams off is accepted"] = function()
    local dir = H.tmpdir()
    local result = export({ "--local-diagrams", "off", "-o", dir .. "/out.pdf" })
    assert(result.code == 0, result.stderr)
    assert(is_pdf(dir .. "/out.pdf"))
    local equals = export({ "--output=" .. dir .. "/eq.pdf", "--local-diagrams=on" })
    assert(equals.code == 0, equals.stderr)
    assert(is_pdf(dir .. "/eq.pdf"))
end

tests["another file can be given, also one with spaces in its path"] = function()
    local dir = H.tmpdir()
    vim.fn.mkdir(dir .. "/with space", "p")
    H.write(dir .. "/with space/my note.md", { "# My note", "", "text" })
    local result, cwd = export({ dir .. "/with space/my note.md" })
    assert(result.code == 0, result.stderr)
    assert(is_pdf(cwd .. "/my note.pdf"), "the PDF is named after the document")
end

tests["a file whose name starts with a dash is not taken for an option"] = function()
    local dir = H.tmpdir()
    H.write(dir .. "/-odd.md", { "# Odd", "", "text" })
    local result, cwd = export({ "--", dir .. "/-odd.md" })
    assert(result.code == 0, result.stderr)
    assert(is_pdf(cwd .. "/-odd.pdf"))
end

tests["mistakes in the command line are reported and nothing is written"] = function()
    local cases = {
        { { "--bogus" }, "unknown option" },
        { { "--local-diagrams", "maybe" }, "use on or off" },
        { { "--local-diagrams" }, "needs a value" },
        { { "-o" }, "needs a value" },
        { { "a.md", "b.md" }, "only one file" },
        { { "/nonexistent/x.md" }, "no such file" },
        { { "-o", "/nonexistent/dir/x.pdf" }, "directory of the PDF does not exist" },
    }
    for _, case in ipairs(cases) do
        local result, dir = export(case[1])
        assert(result.code == 1, table.concat(case[1], " ") .. " must fail")
        assert(
            (result.stderr or ""):find(case[2], 1, true),
            table.concat(case[1], " ") .. ": " .. (result.stderr or "")
        )
        assert(#vim.fn.glob(dir .. "/*", false, true) == 0, "nothing may be written")
    end
end

tests["the PDF never overwrites the document"] = function()
    local dir = H.tmpdir()
    H.write(dir .. "/doc.md", { "# Keep me" })
    local result = export({ dir .. "/doc.md", "-o", dir .. "/doc.md" })
    assert(result.code == 1)
    assert(result.stderr:find("would overwrite the document", 1, true), result.stderr)
    assert(vim.fn.readfile(dir .. "/doc.md")[1] == "# Keep me", "the document must be untouched")
end

tests["--help prints the usage and exits cleanly"] = function()
    local result = vim.system({ script, "--help" }, { text = true }):wait(10000)
    assert(result.code == 0)
    assert(result.stdout:find("Usage: examples/export.sh", 1, true))
    assert(result.stdout:find("--output", 1, true))
    assert(result.stdout:find("--local-diagrams", 1, true))
end

tests["missing npm dependencies are explained, with the command that fixes them"] = function()
    -- a copy of the examples without the engine's node_modules, like a fresh checkout
    local dir = H.tmpdir()
    vim.fn.mkdir(dir .. "/examples", "p")
    vim.fn.mkdir(dir .. "/preview-engine", "p")
    vim.fn.system({ "cp", script, dir .. "/examples/export.sh" })
    H.write(dir .. "/doc.md", { "# Doc" })
    local result = vim.system({ dir .. "/examples/export.sh", dir .. "/doc.md" }, { text = true, cwd = dir })
        :wait(10000)
    assert(result.code == 1)
    assert(result.stderr:find("npm dependencies are missing", 1, true), result.stderr)
    assert(result.stderr:find("npm install --prefix", 1, true), result.stderr)
end

tests["a missing Node.js is explained"] = function()
    local result = export({}, { env = { NODE = "/nonexistent/node" } })
    assert(result.code == 1)
    assert(result.stderr:find("Node.js not found", 1, true), result.stderr)
end

return tests
