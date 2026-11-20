-- Test runner. Usage (from the repository root):
--   nvim --headless -u NONE -l tests/run.lua [name-filter]
local root = vim.fn.fnamemodify(debug.getinfo(1).source:sub(2), ":p:h:h")
vim.opt.runtimepath:prepend(root)
package.path = root .. "/tests/?.lua;" .. package.path

local filter = arg and arg[1]
local failures = 0
local total = 0

local files = vim.fn.glob(root .. "/tests/*_test.lua", false, true)
table.sort(files)

for _, file in ipairs(files) do
    local suite = dofile(file)
    local names = vim.tbl_keys(suite)
    table.sort(names)
    print(vim.fn.fnamemodify(file, ":t"))
    for _, name in ipairs(names) do
        if not filter or name:find(filter, 1, true) then
            total = total + 1
            local ok, err = xpcall(suite[name], debug.traceback)
            -- never leak a preview server or buffers into the next test
            pcall(function()
                require("remark-preview.session").stop_all()
                require("remark-preview.config").setup({})
                vim.cmd("silent! %bwipeout!")
            end)
            require("helpers").restore()
            if ok then
                print("  ok   " .. name)
            else
                failures = failures + 1
                print("  FAIL " .. name .. "\n" .. tostring(err))
            end
        end
    end
end

print(string.format("\n%d tests, %d failed", total, failures))
vim.cmd(failures == 0 and "qall!" or "cquit 1")
