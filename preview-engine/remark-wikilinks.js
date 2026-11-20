import { existsSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { slug } from "github-slugger";
import { findAndReplace } from "mdast-util-find-and-replace";
import { directoryWithin, vaultFor } from "./vault.js";

// [[Note]], [[Note|alias]], [[Note#Heading]], [[#Heading]], ![[image.png]], ![[image.png|300]]
const WIKILINK = /(!?)\[\[([^[\]\r\n|]+?)(?:\|([^[\]\r\n]*?))?\]\]/g;

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".svg", ".ico"]);
const SIZE = /^(\d+)(?:x(\d+))?$/;

/** wikilinks: true / false, or "auto" (the default): on when the project root is an Obsidian vault. */
export function wikilinksEnabled(mode, root) {
  if (mode === true || mode === "true") {
    return true;
  }
  if (mode === false || mode === "false") {
    return false;
  }
  return existsSync(join(root, ".obsidian"));
}

// "Note#Heading" -> { target: "Note", heading: "Heading" }; "Note#^block" has no heading.
function splitTarget(inner) {
  const hash = inner.indexOf("#");
  if (hash === -1) {
    return { target: inner.trim(), heading: null };
  }
  const fragment = inner.slice(hash + 1);
  return {
    target: inner.slice(0, hash).trim(),
    heading: fragment.startsWith("^") ? null : fragment.split("#").pop().trim() || null,
  };
}

const encodePath = (path) => path.split("/").map(encodeURIComponent).join("/");

/**
 * Turns Obsidian wikilinks into links and images. A link names a file without its folder, so the
 * target is looked up in the vault; the resulting root-relative URL goes through the same
 * rewriting as any other link (see rehype-rewrite-urls.js), which serves files and opens notes.
 * Needs file.data.links; file.data.wikilinks sets the mode.
 */
export default function remarkWikilinks() {
  return (tree, file) => {
    const links = file.data.links;
    if (!links || !wikilinksEnabled(file.data.wikilinks, links.root)) {
      return;
    }
    const vault = vaultFor(links.root);
    const fromDirectory = directoryWithin(links.root, links.docDir);

    findAndReplace(
      tree,
      [
        [
          WIKILINK,
          (match, bang, inner, alias) => {
            const embed = bang === "!";
            const { target, heading } = splitTarget(inner);
            const fragment = heading ? `#${slug(heading)}` : "";
            const label = target ? (heading ? `${target} > ${heading}` : target) : heading;
            if (!label) {
              return false; // "[[#]]": leave the text alone
            }
            const text = alias && !(embed && SIZE.test(alias.trim())) ? alias.trim() : label;

            // [[#Heading]]: a heading of this document
            if (!target) {
              return link(fragment, text);
            }

            const path = vault.lookup(target, fromDirectory);
            if (!path) {
              return {
                type: "wikilink",
                data: {
                  hName: "a",
                  hProperties: { className: ["wikilink", "unresolved"], title: `${target}: not found in the vault` },
                },
                children: [{ type: "text", value: text }],
              };
            }
            const url = `/${encodePath(path)}${fragment}`;

            if (embed && IMAGE_EXTENSIONS.has(extname(path).toLowerCase())) {
              const size = alias ? SIZE.exec(alias.trim()) : null;
              const properties = {};
              if (size) {
                properties.width = size[1];
                if (size[2]) {
                  properties.height = size[2];
                }
              }
              return {
                type: "image",
                url,
                alt: alias && !size ? alias.trim() : basename(path),
                data: { hProperties: properties },
              };
            }
            return link(url, text);
          },
        ],
      ],
      { ignore: ["link", "linkReference"] },
    );
  };
}

function link(url, text) {
  return {
    type: "link",
    url,
    data: { hProperties: { className: ["wikilink"] } },
    children: [{ type: "text", value: text }],
  };
}
