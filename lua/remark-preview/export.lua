local config = require("remark-preview.config")
local util = require("remark-preview.util")

local M = {}

local function remark_bin()
    return util.engine_path("node_modules/.bin/remark")
end

-- Binaries needed by the export (the preview itself only needs node).
function M.check()
    local missing = {}
    for _, bin in ipairs({ "node", remark_bin() }) do
        if vim.fn.executable(bin) ~= 1 then
            table.insert(missing, bin)
        end
    end
    return missing
end

-- Exports the file of a buffer to PDF with the print theme.
-- Step 1 renders a standalone HTML file, step 2 prints it with puppeteer.
function M.export_pdf(bufnr, open_after)
    local input = util.buffer_path(bufnr)
    if not input or vim.fn.filereadable(input) ~= 1 then
        util.notify("save the buffer to a file first", vim.log.levels.WARN)
        return
    end
    local missing = M.check()
    if #missing > 0 then
        util.notify(
            "missing " .. table.concat(missing, ", ") .. ", run :RemarkPreviewInstallDeps",
            vim.log.levels.ERROR
        )
        return
    end

    local output_pdf = vim.fn.fnamemodify(input, ":r") .. ".pdf"
    local temp_html = vim.fn.tempname() .. ".html"

    util.notify("exporting to PDF (print theme)...")
    vim.fn.jobstart({
        remark_bin(),
        input,
        "--rc-path",
        util.engine_path("remarkrc.js"),
        "--output",
        temp_html,
    }, {
        env = {
            PREVIEW_THEME = "print",
            ENGINE_PATH = util.engine_path(""),
            DOC_DIR = vim.fn.fnamemodify(input, ":h"),
        },
        on_exit = function(_, render_code)
            if render_code ~= 0 then
                util.notify("export failed: could not render the document", vim.log.levels.ERROR)
                return
            end
            vim.fn.jobstart({ "node", util.engine_path("export.js"), temp_html, output_pdf }, {
                env = {
                    PDF_FORMAT = config.options.pdf.format,
                    PDF_MARGIN = config.options.pdf.margin,
                },
                on_exit = function(_, pdf_code)
                    os.remove(temp_html)
                    if pdf_code ~= 0 then
                        util.notify("export failed, run :RemarkPreviewInstallDeps", vim.log.levels.ERROR)
                        return
                    end
                    util.notify("PDF saved: " .. output_pdf)
                    if open_after then
                        util.open_external(output_pdf)
                    end
                end,
            })
        end,
    })
end

return M
