// Browser-side client of the preview page: TOC sidebar, scroll spy, diagram zoom and live updates.
// Plain script (no modules): loaded by the page shell after morphdom.
(function () {
  "use strict";

  var script = document.currentScript;
  var id = script.getAttribute("data-id");
  var version = Number(script.getAttribute("data-version")) || 0;

  var content = document.getElementById("content");
  var status = document.getElementById("rp-status");
  var errorBox = document.getElementById("rp-error");

  // ---------------------------------------------------------------- sidebar
  var sidebar = document.createElement("div");
  sidebar.className = "toc-sidebar";
  sidebar.innerHTML = "<h3>Contents</h3><ul id=\"sb-list\"></ul>";
  document.body.appendChild(sidebar);

  var toggle = document.createElement("div");
  toggle.className = "toc-toggle";
  toggle.textContent = "\u2630";
  toggle.onclick = function () {
    sidebar.classList.toggle("open");
    document.body.classList.toggle("sidebar-open");
  };
  document.body.appendChild(toggle);

  // Theme menu: the choice goes in a cookie (without a port, so it is kept for other documents and
  // after a restart), which the server reads when it builds the page; then the page is reloaded.
  var themeMenu = document.createElement("select");
  themeMenu.className = "rp-theme-menu";
  themeMenu.title = "theme";
  ["dark", "light", "github-dark", "github-light"].forEach(function (name) {
    var option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    option.selected = name === document.body.className;
    themeMenu.appendChild(option);
  });
  themeMenu.onchange = function () {
    document.cookie = "rp_theme=" + themeMenu.value + "; Path=/; SameSite=Strict; Max-Age=31536000";
    window.location.reload();
  };
  document.body.appendChild(themeMenu);

  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        document.querySelectorAll(".toc-sidebar a").forEach(function (a) {
          a.classList.remove("active");
        });
        var link = document.querySelector('.toc-sidebar a[href="#' + CSS.escape(entry.target.id) + '"]');
        if (link) link.classList.add("active");
      });
    },
    { rootMargin: "0px 0px -80% 0px" }
  );

  // Rebuilds the sidebar list and the scroll spy from the current headings.
  function buildSidebar() {
    var list = document.getElementById("sb-list");
    list.textContent = "";
    observer.disconnect();
    var headings = content.querySelectorAll("h1, h2, h3, h4");
    headings.forEach(function (h) {
      if (!h.id) return;
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.href = "#" + h.id;
      a.textContent = h.textContent;
      a.className = "depth-" + h.tagName.substring(1);
      li.appendChild(a);
      list.appendChild(li);
      observer.observe(h);
    });
  }

  // ---------------------------------------------------------------- diagrams
  // Zoom and pan of the diagram frames (see rehype-kroki-img-bg.js for the markup). The view of a
  // frame is kept on the element, which morphdom keeps between updates; the handlers are on
  // #content, so they need no rebinding. Drag pans, Ctrl+wheel (or a pinch) and the buttons zoom.
  var MIN_SCALE = 0.1;
  var MAX_SCALE = 6;

  function viewportOf(frame) {
    return frame.querySelector(".rp-diagram-viewport");
  }

  function applyView(frame) {
    var v = frame._view;
    viewportOf(frame).style.transform = "translate(" + v.x + "px, " + v.y + "px) scale(" + v.s + ")";
  }

  // Scales the diagram down to the frame if it is bigger (never up) and centers it.
  function fitDiagram(frame) {
    var viewport = viewportOf(frame);
    var w = viewport.offsetWidth;
    var h = viewport.offsetHeight;
    var fw = frame.clientWidth;
    var fh = frame.clientHeight;
    var s = w > 0 && h > 0 ? Math.min(1, fw / w, fh / h) : 1;
    frame._view = { s: s, x: (fw - w * s) / 2, y: 0 };
    applyView(frame);
  }

  // Zooms by a factor keeping the point (ax, ay), relative to the frame, where it is.
  function zoomDiagram(frame, factor, ax, ay) {
    var v = frame._view || { s: 1, x: 0, y: 0 };
    var s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.s * factor));
    frame._view = { s: s, x: ax - (ax - v.x) * (s / v.s), y: ay - (ay - v.y) * (s / v.s) };
    applyView(frame);
  }

  // Frames that have no view yet (new on the page) and whose image is already loaded.
  function fitNewDiagrams() {
    content.querySelectorAll(".rp-diagram").forEach(function (frame) {
      var img = frame.querySelector("img");
      if (!frame._view && img && img.complete) fitDiagram(frame);
    });
  }

  // A (re)loaded image starts fully visible; this also covers an image that changed in an update.
  content.addEventListener(
    "load",
    function (e) {
      var frame = e.target.closest && e.target.closest(".rp-diagram");
      if (frame) fitDiagram(frame);
    },
    true
  );

  content.addEventListener(
    "wheel",
    function (e) {
      var frame = e.target.closest(".rp-diagram");
      // Ctrl+wheel, and a trackpad pinch which browsers report the same way; a plain wheel scrolls
      if (!frame || !e.ctrlKey || !frame._view) return;
      e.preventDefault();
      var rect = frame.getBoundingClientRect();
      zoomDiagram(frame, e.deltaY < 0 ? 1.1 : 0.9, e.clientX - rect.left, e.clientY - rect.top);
    },
    { passive: false }
  );

  var drag = null;
  var HANDLE = 18; // px of the bottom-right corner left to the browser's resize handle
  content.addEventListener("pointerdown", function (e) {
    var frame = e.target.closest(".rp-diagram");
    if (!frame || e.button !== 0 || e.target.closest(".rp-diagram-controls") || !frame._view) return;
    var rect = frame.getBoundingClientRect();
    if (e.clientX > rect.right - HANDLE && e.clientY > rect.bottom - HANDLE) return;
    drag = { frame: frame, id: e.pointerId, x: e.clientX, y: e.clientY, view: frame._view };
    frame.setPointerCapture(e.pointerId);
    frame.classList.add("is-panning");
    e.preventDefault();
  });
  content.addEventListener("pointermove", function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    drag.frame._view = { s: drag.view.s, x: drag.view.x + e.clientX - drag.x, y: drag.view.y + e.clientY - drag.y };
    applyView(drag.frame);
  });
  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    drag.frame.classList.remove("is-panning");
    drag = null;
  }
  content.addEventListener("pointerup", endDrag);
  content.addEventListener("pointercancel", endDrag);

  content.addEventListener("dblclick", function (e) {
    var frame = e.target.closest(".rp-diagram");
    if (frame && !e.target.closest(".rp-diagram-controls")) fitDiagram(frame);
  });

  content.addEventListener("click", function (e) {
    var btn = e.target.closest(".rp-diagram-controls button");
    if (!btn) return;
    var frame = btn.closest(".rp-diagram");
    var act = btn.getAttribute("data-act");
    if (act === "reset") return fitDiagram(frame);
    if (!frame._view) fitDiagram(frame);
    zoomDiagram(frame, act === "in" ? 1.2 : 1 / 1.2, frame.clientWidth / 2, frame.clientHeight / 2);
  });

  // ---------------------------------------------------------------- updates
  // A banner on top of the page: an error (the render failed, the last good one is shown) or a
  // warning (the render worked but, for example, a diagram could not be drawn).
  function showBanner(message, isWarning) {
    errorBox.textContent = message;
    errorBox.className = isWarning ? "warning" : "";
    errorBox.hidden = false;
  }

  function hideBanner() {
    errorBox.hidden = true;
    errorBox.textContent = "";
  }

  function showError(message) {
    showBanner(message, false);
  }

  // Swaps the rendered body in place: morphdom only touches what changed, so
  // the scroll position and unchanged elements (images, diagrams) are kept.
  function applyUpdate(data) {
    var x = window.scrollX;
    var y = window.scrollY;
    var next = document.createElement("div");
    next.innerHTML = data.html;
    morphdom(content, next, {
      childrenOnly: true,
      onBeforeElUpdated: function (from, to) {
        // the zoom and pan of a diagram live in its style, and so does the size the user gave the
        // frame: the new markup has neither
        if (from.classList.contains("rp-diagram-viewport") && from.hasAttribute("style")) {
          to.setAttribute("style", from.getAttribute("style"));
        }
        if (from.classList.contains("rp-diagram") && from.style.height) {
          to.style.width = from.style.width;
          to.style.height = from.style.height;
        }
        return true;
      },
    });
    if (data.title) document.title = data.title;
    version = data.version;
    buildSidebar();
    fitNewDiagrams();
    if (data.warnings && data.warnings.length > 0) {
      showBanner(data.warnings.join("\n"), true);
    } else {
      hideBanner();
    }
    window.scrollTo({ left: x, top: y, behavior: "instant" });
  }

  // Scrolls so that a line of the markdown source is about a third of the way down the window.
  function scrollToLine(line) {
    var entries = [];
    var offset = window.scrollY;
    content.querySelectorAll("[data-line]").forEach(function (el) {
      var rect = el.getBoundingClientRect();
      entries.push({
        start: Number(el.getAttribute("data-line")),
        end: Number(el.getAttribute("data-line-end")) || Number(el.getAttribute("data-line")),
        top: rect.top + offset,
        height: rect.height,
      });
    });
    var target = RemarkSync.lineToOffset(entries, line);
    if (target === null) {
      return;
    }
    window.scrollTo({ top: Math.max(0, target - window.innerHeight / 3), behavior: "smooth" });
  }

  function connect() {
    var source = new EventSource("/d/" + id + "/events?v=" + version);

    source.onopen = function () {
      status.className = "connected";
      status.title = "live preview connected";
    };
    source.onerror = function () {
      // EventSource reconnects by itself and sends Last-Event-ID.
      status.className = "disconnected";
      status.title = "live preview disconnected";
    };
    source.addEventListener("update", function (e) {
      applyUpdate(JSON.parse(e.data));
    });
    source.addEventListener("scroll", function (e) {
      scrollToLine(JSON.parse(e.data).line);
    });
    source.addEventListener("render-error", function (e) {
      showError(JSON.parse(e.data).message);
    });
    source.addEventListener("reload", function () {
      window.location.reload();
    });
    source.addEventListener("closed", function () {
      source.close();
      status.className = "disconnected";
      status.title = "preview closed";
      showError("This preview was closed in Neovim.");
    });
  }

  buildSidebar();
  fitNewDiagrams();
  connect();
})();
