#!/bin/bash
# Opens a Markdown file in Neovim, with this checkout of the plugin and nothing else loaded, and
# starts its preview in the browser. Your own Neovim configuration is not used or modified.
#
# Usage: examples/preview.sh [options] [file.md]
#
#   file.md             the document to open (default: examples/vault/features.md, the reference)
#   -t, --theme THEME   colour theme: dark (default) or light
#   -l, --local-diagrams on|off
#                       draw mermaid and plantuml with the merman-cli and plantuml installed here (on, the
#                       default), or always with the Kroki server (off); see :checkhealth remark-preview
#   -f, --follow        scroll the browser along with the cursor
#   -n, --no-browser    show the URL instead of opening a browser (for example over SSH)
#   -h, --help          this text
#
# Inside Neovim: <space>mp toggles the preview, <space>ms scrolls the browser to the cursor line,
# <space>me exports a PDF. Quit with :q; the preview stops by itself.
#
# Environment: NVIM selects the Neovim to run (default: nvim).

set -euo pipefail

die() {
    echo "preview.sh: $*" >&2
    exit 1
}

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NVIM_BIN="${NVIM:-nvim}"
THEME="dark"
LOCAL_DIAGRAMS="on"
FOLLOW=0
NO_BROWSER=0
FILE=""

while [ $# -gt 0 ]; do
    case "$1" in
        -t | --theme)
            [ $# -ge 2 ] || die "$1 needs a value: dark or light"
            THEME="$2"
            shift 2
            ;;
        --theme=*)
            THEME="${1#--theme=}"
            shift
            ;;
        -l | --local-diagrams)
            [ $# -ge 2 ] || die "$1 needs a value: on or off"
            LOCAL_DIAGRAMS="$2"
            shift 2
            ;;
        --local-diagrams=*)
            LOCAL_DIAGRAMS="${1#--local-diagrams=}"
            shift
            ;;
        -f | --follow)
            FOLLOW=1
            shift
            ;;
        -n | --no-browser)
            NO_BROWSER=1
            shift
            ;;
        -h | --help)
            sed -n '2,/^# Environment/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        --)
            shift
            [ $# -le 1 ] || die "only one file can be opened"
            FILE="${1:-}"
            break
            ;;
        -*)
            die "unknown option: $1 (try --help)"
            ;;
        *)
            [ -z "$FILE" ] || die "only one file can be opened"
            FILE="$1"
            shift
            ;;
    esac
done

case "$THEME" in
    dark | light) ;;
    *) die "unknown theme \"$THEME\": use dark or light" ;;
esac

case "$LOCAL_DIAGRAMS" in
    on | off) ;;
    *) die "unknown value \"$LOCAL_DIAGRAMS\" for --local-diagrams: use on or off" ;;
esac

[ -n "$FILE" ] || FILE="$ROOT/examples/vault/features.md"
[ -f "$FILE" ] || die "no such file: $FILE"

command -v "$NVIM_BIN" >/dev/null 2>&1 || die "Neovim not found (looked for \"$NVIM_BIN\"; set NVIM to its path)"
command -v node >/dev/null 2>&1 || die "Node.js not found: it is needed by the preview server"
[ -d "$ROOT/preview-engine/node_modules/morphdom" ] ||
    die "the npm dependencies are missing: run  npm install --prefix \"$ROOT/preview-engine\""

export REMARK_PREVIEW_ROOT="$ROOT"
export REMARK_PREVIEW_THEME="$THEME"
export REMARK_PREVIEW_LOCAL_DIAGRAMS="$LOCAL_DIAGRAMS"
export REMARK_PREVIEW_FOLLOW="$FOLLOW"
export REMARK_PREVIEW_NO_BROWSER="$NO_BROWSER"

# --clean: no user configuration, plugins or shada; -S runs our small configuration after the file is loaded.
exec "$NVIM_BIN" --clean -S "$ROOT/examples/preview-init.lua" -- "$FILE"
