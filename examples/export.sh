#!/bin/bash
# Exports a Markdown file to PDF with the print theme, using this checkout of the plugin. Neovim is
# not needed and your own configuration is not used.
#
# Usage: examples/export.sh [options] [file.md]
#
#   file.md             the document to export (default: examples/vault/features.md, the reference)
#   -o, --output FILE   where to write the PDF (default: <name of the document>.pdf in the current
#                       directory, so that nothing is written into the example vault)
#   -l, --local-diagrams on|off
#                       draw mermaid and plantuml with the merman-cli and plantuml installed here (on, the
#                       default), or always with the Kroki server (off); see :checkhealth remark-preview
#   -h, --help          this text
#
# Prints the path of the PDF. The page size and margin can be set with PDF_FORMAT (default A4) and
# PDF_MARGIN (default 1cm); PREVIEW_KROKI_SERVER selects another Kroki server.
#
# Environment: NODE selects the Node.js to run (default: node).

set -euo pipefail

die() {
    echo "export.sh: $*" >&2
    exit 1
}

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="${NODE:-node}"
LOCAL_DIAGRAMS="on"
OUTPUT=""
FILE=""

while [ $# -gt 0 ]; do
    case "$1" in
        -o | --output)
            [ $# -ge 2 ] || die "$1 needs a value: the PDF file to write"
            OUTPUT="$2"
            shift 2
            ;;
        --output=*)
            OUTPUT="${1#--output=}"
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
        -h | --help)
            sed -n '2,/^# Environment/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        --)
            shift
            [ $# -le 1 ] || die "only one file can be exported"
            FILE="${1:-}"
            break
            ;;
        -*)
            die "unknown option: $1 (try --help)"
            ;;
        *)
            [ -z "$FILE" ] || die "only one file can be exported"
            FILE="$1"
            shift
            ;;
    esac
done

case "$LOCAL_DIAGRAMS" in
    on | off) ;;
    *) die "unknown value \"$LOCAL_DIAGRAMS\" for --local-diagrams: use on or off" ;;
esac

[ -n "$FILE" ] || FILE="$ROOT/examples/vault/features.md"
[ -f "$FILE" ] || die "no such file: $FILE"

if [ -z "$OUTPUT" ]; then
    NAME="$(basename "$FILE")"
    OUTPUT="$PWD/${NAME%.*}.pdf"
fi
[ -d "$(dirname "$OUTPUT")" ] || die "the directory of the PDF does not exist: $(dirname "$OUTPUT")"
[ "$FILE" -ef "$OUTPUT" ] && die "the PDF would overwrite the document: $FILE"

command -v "$NODE_BIN" >/dev/null 2>&1 || die "Node.js not found (looked for \"$NODE_BIN\"; set NODE to its path)"
[ -d "$ROOT/preview-engine/node_modules/morphdom" ] ||
    die "the npm dependencies are missing: run  npm install --prefix \"$ROOT/preview-engine\""
[ -d "$ROOT/preview-engine/node_modules/puppeteer" ] ||
    die "puppeteer is missing, it prints the PDF: run  npm install --prefix \"$ROOT/preview-engine\""

if [ "$LOCAL_DIAGRAMS" = "off" ]; then
    export PREVIEW_LOCAL_DIAGRAMS=false
fi

"$NODE_BIN" "$ROOT/preview-engine/export-cli.js" "$FILE" "$OUTPUT"
