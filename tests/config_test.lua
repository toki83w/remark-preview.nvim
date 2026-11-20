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

return tests
