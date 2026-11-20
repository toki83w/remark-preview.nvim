// Browser-side client of the preview page: TOC sidebar, scroll spy and live updates.
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

  // ---------------------------------------------------------------- updates
  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  function hideError() {
    errorBox.hidden = true;
    errorBox.textContent = "";
  }

  // Swaps the rendered body in place: morphdom only touches what changed, so
  // the scroll position and unchanged elements (images, diagrams) are kept.
  function applyUpdate(data) {
    var x = window.scrollX;
    var y = window.scrollY;
    var next = document.createElement("div");
    next.innerHTML = data.html;
    morphdom(content, next, { childrenOnly: true });
    if (data.title) document.title = data.title;
    version = data.version;
    buildSidebar();
    hideError();
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
  connect();
})();
