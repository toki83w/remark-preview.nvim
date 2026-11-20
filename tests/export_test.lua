local H = require("helpers")
local export = require("remark-preview.export")

local tests = {}

-- Needs the npm dependencies and a Chrome that puppeteer can launch.
tests["export writes a PDF next to the document and opens it on request"] = function()
    local opened = H.capture_open()
    local messages = H.capture_notify()
    local dir = H.tmpdir()
    H.write(dir .. "/doc.md", { "# Export", "", "Some **text** to print.", "", "- [x] done" })
    local buf = H.edit(dir .. "/doc.md")

    export.export_pdf(buf, true)
    H.wait(function()
        return #opened > 0
            or vim.iter(messages):any(function(m)
                return m.msg:find("export failed", 1, true) ~= nil
            end)
    end, 90000, "export neither finished nor failed")

    assert(#opened == 1, "export failed: " .. vim.inspect(messages))
    assert(opened[1] == dir .. "/doc.pdf")
    local stat = vim.uv.fs_stat(dir .. "/doc.pdf")
    assert(stat and stat.size > 1000, "PDF missing or empty")
    local header = vim.fn.readfile(dir .. "/doc.pdf", "b", 1)[1]
    assert(header:sub(1, 5) == "%PDF-", "not a PDF")
end

tests["export of an unsaved buffer is refused"] = function()
    local messages = H.capture_notify()
    vim.cmd("enew")
    export.export_pdf(vim.api.nvim_get_current_buf(), false)
    assert(#messages == 1 and messages[1].msg:find("save the buffer", 1, true))
end

return tests
