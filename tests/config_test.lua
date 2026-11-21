local H = require("helpers")
local config = require("remark-preview.config")

local tests = {}

tests["defaults"] = function()
    local options = config.setup(nil)
    assert(options.theme == "dark")
    assert(options.port == 0)
    assert(options.debug == false)
    assert(options.pdf.format == "A4" and options.pdf.margin == "1cm")
end

tests["user options are merged deeply"] = function()
    local options = config.setup({ theme = "light", pdf = { margin = "2cm" } })
    assert(options.theme == "light")
    assert(options.pdf.margin == "2cm")
    assert(options.pdf.format == "A4")
end

tests["setup does not modify the table passed by the user"] = function()
    local messages = H.capture_notify()
    local opts = { port_base = 8080, theme = "light" }
    config.setup(opts)
    assert(opts.port_base == 8080)
    H.wait(function()
        return #messages > 0
    end, 1000)
end

tests["port_base is deprecated, warned about and ignored"] = function()
    local messages = H.capture_notify()
    local options = config.setup({ port_base = 8080 })
    H.wait(function()
        return #messages > 0
    end, 1000, "no deprecation warning")
    assert(messages[1].msg:find("port_base", 1, true))
    assert(options.port_base == nil)
    assert(options.port == 0)
end

tests["an unknown theme falls back to dark with a warning"] = function()
    local messages = H.capture_notify()
    local options = config.setup({ theme = "solarized" })
    assert(options.theme == "dark")
    H.wait(function()
        return #messages > 0
    end, 1000)
    assert(messages[1].msg:find("solarized", 1, true))
end

tests["an invalid port falls back to 0 with a warning"] = function()
    local messages = H.capture_notify()
    assert(config.setup({ port = 70000 }).port == 0)
    H.wait(function()
        return #messages > 0
    end, 1000)
end

tests["sync_on_cursor is off by default and only true turns it on"] = function()
    assert(config.setup(nil).sync_on_cursor == false)
    assert(config.setup({ sync_on_cursor = true }).sync_on_cursor == true)
    assert(config.setup({ sync_on_cursor = "yes" }).sync_on_cursor == false)
end

tests["local_diagrams is on by default and must be a boolean"] = function()
    local messages = H.capture_notify()
    assert(config.setup(nil).local_diagrams == true)
    assert(config.setup({ local_diagrams = false }).local_diagrams == false)
    assert(config.setup({ local_diagrams = "no" }).local_diagrams == true)
    H.wait(function()
        return #messages >= 1
    end, 1000)
    assert(messages[1].msg:find("local_diagrams", 1, true))
end

tests["kroki.server defaults to kroki.io and can be pointed at a self-hosted instance"] = function()
    assert(config.setup(nil).kroki.server == "https://kroki.io")
    assert(config.setup({ kroki = { server = "http://localhost:8000/" } }).kroki.server == "http://localhost:8000/")
end

tests["an invalid kroki.server falls back to the default with a warning"] = function()
    local messages = H.capture_notify()
    assert(config.setup({ kroki = { server = "ftp://nope" } }).kroki.server == "https://kroki.io")
    assert(config.setup({ kroki = { server = 42 } }).kroki.server == "https://kroki.io")
    assert(config.setup({ kroki = "https://kroki.io" }).kroki.server == "https://kroki.io")
    H.wait(function()
        return #messages >= 3
    end, 1000)
    assert(messages[1].msg:find("kroki.server", 1, true))
end

tests["wikilinks is auto by default and accepts true and false"] = function()
    assert(config.setup(nil).wikilinks == "auto")
    assert(config.setup({ wikilinks = true }).wikilinks == true)
    assert(config.setup({ wikilinks = false }).wikilinks == false)
end

tests["an invalid wikilinks value falls back to auto with a warning"] = function()
    local messages = H.capture_notify()
    assert(config.setup({ wikilinks = "sometimes" }).wikilinks == "auto")
    H.wait(function()
        return #messages > 0
    end, 1000)
    assert(messages[1].msg:find("wikilinks", 1, true))
end

tests["root_markers replaces the default list instead of merging into it"] = function()
    assert(vim.deep_equal(config.setup(nil).root_markers, { ".obsidian", ".git" }))
    assert(vim.deep_equal(config.setup({ root_markers = { ".root" } }).root_markers, { ".root" }))
end

tests["invalid root_markers fall back to the defaults with a warning"] = function()
    local messages = H.capture_notify()
    local options = config.setup({ root_markers = { 1, "" } })
    assert(vim.deep_equal(options.root_markers, { ".obsidian", ".git" }))
    H.wait(function()
        return #messages > 0
    end, 1000)
    assert(messages[1].msg:find("root_markers", 1, true))
end

return tests
