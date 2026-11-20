local config = require("remark-preview.config")
local server = require("remark-preview.server")
local session = require("remark-preview.session")
local util = require("remark-preview.util")

local M = {}

-- Exports the file of a buffer to PDF with the print theme. The preview server renders the page
-- (images, diagrams and links resolve as in the preview) and prints it with puppeteer.
function M.export_pdf(bufnr, open_after)
    local input = util.buffer_path(bufnr)
    if not input or vim.fn.filereadable(input) ~= 1 then
        util.notify("save the buffer to a file first", vim.log.levels.WARN)
        return
    end
    if vim.fn.isdirectory(util.engine_path("node_modules/puppeteer")) ~= 1 then
        util.notify("puppeteer is missing, run :RemarkPreviewInstallDeps", vim.log.levels.ERROR)
        return
    end

    local output_pdf = vim.fn.fnamemodify(input, ":r") .. ".pdf"
    util.notify("exporting to PDF (print theme)...")

    -- the server must outlive the closing of the last preview while the export runs
    local release = server.retain()
    local function finish()
        release()
        if #session.active() == 0 then
            server.stop_unless_retained()
        end
    end

    server.start(function(ok, err)
        if not ok then
            finish()
            util.notify("export failed: " .. (err or "could not start the preview server"), vim.log.levels.ERROR)
            return
        end
        local job = { type = "export", path = input, out = output_pdf }
        job.format = config.options.pdf.format
        job.margin = config.options.pdf.margin
        server.request(job, "exported", function(message, export_err)
            finish()
            if not message then
                util.notify("export failed: " .. (export_err or "unknown error"), vim.log.levels.ERROR)
                return
            end
            util.notify("PDF saved: " .. output_pdf)
            if open_after then
                util.open_external(output_pdf)
            end
        end)
    end)
end

return M
