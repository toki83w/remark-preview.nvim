import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const DEFAULT_MARKERS = [".obsidian", ".git"];

function realOr(path) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** True when target is root itself or lies below it (lexical check, no symlink resolution). */
export function isInside(root, target) {
  const rel = relative(root, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel));
}

/** True when any path segment starts with a dot (.git, .env, .obsidian, ..). */
export function hasHiddenSegment(relativePath) {
  return relativePath.split(/[\\/]/).some((segment) => segment.startsWith("."));
}

/**
 * The project root of a document: the nearest ancestor directory containing one of
 * the markers (.obsidian or .git by default), else the document's own directory.
 * The home directory is never a root: a dotfiles repository there must not expose
 * everything below it. The result has symlinks resolved.
 *
 * @param {string} docPath
 * @param {{ markers?: string[], home?: string }} options
 */
export function findRoot(docPath, { markers = DEFAULT_MARKERS, home = homedir() } = {}) {
  const docDir = dirname(resolve(docPath));
  const homeReal = realOr(home);
  let dir = docDir;
  for (;;) {
    const dirReal = realOr(dir);
    if (dirReal === homeReal) {
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break; // never treat the filesystem root as a project root
    }
    if (markers.some((marker) => existsSync(join(dir, marker)))) {
      return dirReal;
    }
    dir = parent;
  }
  return realOr(docDir);
}
