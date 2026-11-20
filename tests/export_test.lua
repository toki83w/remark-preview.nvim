local H = require("helpers")
local export = require("remark-preview.export")
local server = require("remark-preview.server")
local session = require("remark-preview.session")

local tests = {}

local function failed(messages)
    return vim.iter(messages):any(function(m)
        return m.msg:find("export failed", 1, true) ~= nil
    end)
end

-- Waits until the export opened its PDF or reported a failure.
local function wait_for_export(opened, messages)
    H.wait(function()
        return #opened > 0 or failed(messages)
    end, 90000, "export neither finished nor failed")
end

local function document(dir)
    H.write(dir .. "/doc.md", { "# Export", "", "Some **text** to print.", "", "- [x] done" })
    return H.edit(dir .. "/doc.md")
end

-- Needs the npm dependencies and a Chrome that puppeteer can launch.
tests["export writes a PDF next to the document and opens it on request"] = function()
    local opened = H.capture_open()
    local messages = H.capture_notify()
    local dir = H.tmpdir()
    export.export_pdf(document(dir), true)
    wait_for_export(opened, messages)

    assert(#opened == 1, "export failed: " .. vim.inspect(messages))
    assert(opened[1] == dir .. "/doc.pdf")
    local stat = vim.uv.fs_stat(dir .. "/doc.pdf")
    assert(stat and stat.size > 1000, "PDF missing or empty")
    local header = vim.fn.readfile(dir .. "/doc.pdf", "b", 1)[1]
    assert(header:sub(1, 5) == "%PDF-", "not a PDF")
end

tests["export can be told not to open the PDF"] = function()
    local opened = H.capture_open()
    local messages = H.capture_notify()
    local dir = H.tmpdir()
    export.export_pdf(document(dir), false)
    H.wait(function()
        return vim.iter(messages):any(function(m)
            return m.msg:find("PDF saved", 1, true) ~= nil
        end) or failed(messages)
    end, 90000, "export did not finish")
    assert(not failed(messages), vim.inspect(messages))
    assert(#opened == 0, "the PDF must not be opened")
    assert(vim.uv.fs_stat(dir .. "/doc.pdf"))
end

tests["the server started for an export stops when it is done"] = function()
    local opened = H.capture_open()
    local messages = H.capture_notify()
    local dir = H.tmpdir()
    export.export_pdf(document(dir), true)
    H.wait(function()
        return server.is_running()
    end, 20000, "the export did not start the server")
    local pid = server.pid()
    wait_for_export(opened, messages)
    assert(not failed(messages), vim.inspect(messages))
    assert(not server.is_running(), "nothing needs the server any more")
    H.wait(function()
        return not H.alive(pid)
    end, 5000, "server process still alive")
end

tests["an export does not stop a preview that is running"] = function()
    local opened = H.capture_open()
    local messages = H.capture_notify()
    local dir = H.tmpdir()
    local buf = document(dir)
    session.start(buf)
    H.wait(function()
        local current = session.get(buf)
        return current and current.url
    end, 20000, "preview did not start")
    local pid = server.pid()

    export.export_pdf(buf, true)
    H.wait(function()
        return #opened == 2 or failed(messages)
    end, 90000, "export did not finish")
    assert(not failed(messages), vim.inspect(messages))
    assert(server.is_running() and server.pid() == pid, "the preview server must stay")
    assert(session.is_active(buf))
end

tests["closing the last preview during an export does not kill the export"] = function()
    local opened = H.capture_open()
    local messages = H.capture_notify()
    local dir = H.tmpdir()
    local buf = document(dir)
    session.start(buf)
    H.wait(function()
        local current = session.get(buf)
        return current and current.url
    end, 20000, "preview did not start")

    export.export_pdf(buf, true)
    session.stop(buf) -- the last preview goes away while the export is under way
    assert(server.is_running(), "the export still needs the server")

    H.wait(function()
        return #opened == 2 or failed(messages)
    end, 90000, "export did not finish")
    assert(not failed(messages), vim.inspect(messages))
    assert(vim.uv.fs_stat(dir .. "/doc.pdf"))
    assert(not server.is_running(), "the server stops once the export is done and no preview is left")
end

tests["a document that disappears is reported as a failed export"] = function()
    local opened = H.capture_open()
    local messages = H.capture_notify()
    local dir = H.tmpdir()
    local buf = document(dir)
    export.export_pdf(buf, true)
    vim.fn.delete(dir .. "/doc.md") -- before the server got to render it
    wait_for_export(opened, messages)
    assert(failed(messages), "the failure must be reported")
    assert(#opened == 0)
    assert(not vim.uv.fs_stat(dir .. "/doc.pdf"))
    H.wait(function()
        return not server.is_running()
    end, 5000, "a failed export must not leave the server running")
end

tests["export of an unsaved buffer is refused"] = function()
    local messages = H.capture_notify()
    vim.cmd("enew")
    export.export_pdf(vim.api.nvim_get_current_buf(), false)
    assert(#messages == 1 and messages[1].msg:find("save the buffer", 1, true))
    assert(not server.is_running())
end

return tests
