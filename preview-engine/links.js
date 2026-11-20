import { existsSync, realpathSync, statSync } from "node:fs";
import { extname, relative, resolve, sep } from "node:path";
import { hasHiddenSegment, isInside } from "./roots.js";

// What the preview serves to the browser. Anything else under the root stays private.
export const ASSET_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".ico", ".svg",
  ".pdf",
  ".mp3", ".wav", ".ogg", ".m4a", ".mp4", ".webm", ".mov",
]);

export const DOCUMENT_EXTENSIONS = new Set([".md", ".markdown"]);

const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

export function isServableAsset(path) {
  return ASSET_EXTENSIONS.has(extname(path).toLowerCase());
}

/** Percent-encodes every segment of a root-relative path. */
export function encodePath(relativePath) {
  return relativePath.split(sep).map(encodeURIComponent).join("/");
}

/**
 * Turns the URLs found in a document into URLs the preview server understands.
 *
 * @param {object} options
 * @param {string} options.root real path of the project root
 * @param {string} options.docDir directory of the document
 * @param {string} options.assetBase URL prefix of the asset route, ending with "/"
 * @param {(absolutePath: string) => string | null} options.docLink URL of the preview of another document
 */
export function createResolver({ root, docDir, assetBase, docLink }) {
  const real = (path) => {
    try {
      return realpathSync(path);
    } catch {
      return null;
    }
  };

  /**
   * @param {string} url the URL as written in the document
   * @param {{ link?: boolean }} how link: true for <a href>, which may point to other documents
   * @returns {{ kind: "keep" } | { kind: "asset" | "doc", url: string } | { kind: "blocked" | "missing", reason: string }}
   */
  function resolveUrl(url, { link = false } = {}) {
    if (url === "" || url.startsWith("#") || url.startsWith("//") || SCHEME.test(url)) {
      return { kind: "keep" };
    }

    const parts = /^([^?#]*)(?:\?[^#]*)?(#.*)?$/.exec(url);
    const hash = parts[2] || "";
    let path;
    try {
      path = decodeURIComponent(parts[1]);
    } catch {
      return { kind: "keep" };
    }
    if (path === "" || path.includes("\0")) {
      return { kind: "keep" };
    }

    // "/x" is relative to the project root; an absolute file system path works when it is inside it.
    const candidates = path.startsWith("/") ? [resolve(root, "." + path), path] : [resolve(docDir, path)];
    const existing = candidates.find((candidate) => existsSync(candidate));
    const target = existing ?? candidates[0];

    const actual = existing ? real(existing) : null;
    if (!isInside(root, actual ?? target)) {
      return { kind: "blocked", reason: "outside the project root" };
    }
    const relativePath = relative(root, actual ?? target);
    if (hasHiddenSegment(relativePath) || hasHiddenSegment(relative(root, target))) {
      return { kind: "blocked", reason: "hidden files are not served" };
    }
    if (!existing) {
      return { kind: "missing", reason: "file not found" };
    }
    if (!statSync(actual).isFile()) {
      return { kind: "blocked", reason: "directories are not served" };
    }

    const extension = extname(actual).toLowerCase();
    if (link && DOCUMENT_EXTENSIONS.has(extension)) {
      const target = docLink ? docLink(actual) : null;
      return target ? { kind: "doc", url: target + hash } : { kind: "blocked", reason: "document not available" };
    }
    if (!isServableAsset(actual)) {
      return { kind: "blocked", reason: "this file type is not served" };
    }
    const modified = Math.floor(statSync(actual).mtimeMs);
    return { kind: "asset", url: `${assetBase}${encodePath(relativePath)}?m=${modified}${hash}` };
  }

  return { resolve: resolveUrl };
}
