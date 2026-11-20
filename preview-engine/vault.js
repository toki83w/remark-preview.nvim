import { readdirSync } from "node:fs";
import { extname, join, sep } from "node:path";
import { ASSET_EXTENSIONS } from "./links.js";

const DEFAULT_MAX_FILES = 50000;
const DEFAULT_TTL_MS = 5000; // the index is rebuilt when older than this
const DEFAULT_MISS_REFRESH_MS = 1000; // ... or when a name is not found, at most this often
const SKIPPED_DIRECTORIES = new Set(["node_modules"]);

/**
 * An index of the files of an Obsidian vault by name, to resolve [[wikilinks]]. A link names a
 * note or attachment without its folder, so any file of the vault can be the target.
 * Dot directories (.obsidian, .git, .trash) and node_modules are not indexed.
 *
 * @param {string} root real path of the vault
 * @param {{ maxFiles?: number, ttlMs?: number, missRefreshMs?: number, now?: () => number }} options
 */
export function createVaultIndex(root, options = {}) {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const missRefreshMs = options.missRefreshMs ?? DEFAULT_MISS_REFRESH_MS;
  const now = options.now ?? Date.now;

  /** @type {Map<string, string[]>} lower-case file name -> paths relative to the root, with "/" */
  let byName = new Map();
  let builtAt = -Infinity;
  let truncated = false;

  function build() {
    const found = new Map();
    let count = 0;
    truncated = false;

    const walk = (directory, prefix) => {
      let entries;
      try {
        entries = readdirSync(directory, { withFileTypes: true });
      } catch {
        return; // unreadable directory: skip it
      }
      for (const entry of entries) {
        if (count >= maxFiles) {
          truncated = true;
          return;
        }
        if (entry.name.startsWith(".")) {
          continue;
        }
        if (entry.isDirectory()) {
          if (!SKIPPED_DIRECTORIES.has(entry.name)) {
            walk(join(directory, entry.name), `${prefix}${entry.name}/`);
          }
        } else if (entry.isFile()) {
          count++;
          const key = entry.name.toLowerCase();
          if (!found.has(key)) {
            found.set(key, []);
          }
          found.get(key).push(`${prefix}${entry.name}`);
        }
      }
    };

    walk(root, "");
    byName = found;
    builtAt = now();
  }

  // The names a link target can stand for: "Note" is Note.md, "pic.png" is itself.
  function fileNames(target) {
    const extension = extname(target).toLowerCase();
    return extension === ".md" || ASSET_EXTENSIONS.has(extension) ? [target] : [`${target}.md`, target];
  }

  function search(target) {
    const wanted = target.replace(/^\/+/, "").toLowerCase();
    for (const name of fileNames(wanted)) {
      const base = name.slice(name.lastIndexOf("/") + 1);
      const matches = (byName.get(base) || []).filter((path) => {
        const lower = path.toLowerCase();
        return lower === name || lower.endsWith(`/${name}`);
      });
      if (matches.length > 0) {
        return matches;
      }
    }
    return [];
  }

  // The candidate sharing the most leading directories with the linking document wins;
  // then the shortest path, then alphabetical order, so the choice is stable.
  function closest(candidates, fromDirectory) {
    const from = fromDirectory.split("/").filter(Boolean);
    const shared = (path) => {
      const directories = path.split("/").slice(0, -1);
      let n = 0;
      while (n < directories.length && n < from.length && directories[n] === from[n]) {
        n++;
      }
      return n;
    };
    return [...candidates].sort(
      (a, b) => shared(b) - shared(a) || a.split("/").length - b.split("/").length || a.localeCompare(b),
    )[0];
  }

  return {
    /** True when the vault holds more files than maxFiles: only the first ones are searched. */
    get truncated() {
      return truncated;
    },

    /**
     * @param {string} target the name written in the link, without #heading or |alias
     * @param {string} fromDirectory directory of the linking document, relative to the root, with "/"
     * @returns {string | null} path of the file relative to the root, with "/"
     */
    lookup(target, fromDirectory = "") {
      if (now() - builtAt > ttlMs) {
        build();
      }
      let candidates = search(target);
      if (candidates.length === 0 && now() - builtAt >= missRefreshMs) {
        build(); // the file may have been created since
        candidates = search(target);
      }
      return candidates.length === 0 ? null : closest(candidates, fromDirectory);
    },
  };
}

/** Directory of a document relative to the root, in the "/" form the index uses. */
export function directoryWithin(root, docDirectory) {
  const relative = docDirectory.startsWith(root) ? docDirectory.slice(root.length) : "";
  return relative.split(sep).filter(Boolean).join("/");
}

// One index per vault, shared by every document of the vault.
const indexes = new Map();

/** The index of the vault with this (real) root path. */
export function vaultFor(root) {
  if (!indexes.has(root)) {
    indexes.set(root, createVaultIndex(root));
  }
  return indexes.get(root);
}
