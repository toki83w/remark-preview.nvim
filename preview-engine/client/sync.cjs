// Maps a line of the markdown source to a vertical position in the rendered page.
// Pure (no DOM), so it can be tested in Node; loaded as a plain script in the browser.
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.RemarkSync = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /**
   * @param {Array<{start: number, end: number, top: number, height: number}>} entries
   *   the elements carrying data-line / data-line-end, in document order;
   *   top is measured from the top of the page
   * @param {number} line 1-based source line
   * @returns {number|null} vertical position in px from the top of the page, null without entries
   */
  function lineToOffset(entries, line) {
    if (!entries || entries.length === 0) {
      return null;
    }

    // The last element starting at or before the line (the innermost one for nested blocks).
    var index = -1;
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].start <= line) {
        index = i;
      }
    }

    // Before the first element: from the top of the page to that element.
    if (index === -1) {
      var first = entries[0];
      var before = (line - 1) / Math.max(1, first.start - 1);
      return Math.max(0, Math.min(1, before)) * first.top;
    }

    var current = entries[index];
    var bottom = current.top + current.height;

    // Inside the element: proportional to the lines it spans.
    if (line <= current.end) {
      var span = current.end - current.start + 1;
      return current.top + ((line - current.start) / span) * current.height;
    }

    // After the element: between its bottom and the next element (blank lines, unstamped blocks).
    var next = entries[index + 1];
    if (!next) {
      return bottom;
    }
    var gap = Math.max(1, next.start - current.end);
    var fraction = Math.max(0, Math.min(1, (line - current.end) / gap));
    return bottom + fraction * Math.max(0, next.top - bottom);
  }

  return { lineToOffset: lineToOffset };
});
