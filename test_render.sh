#!/bin/bash
# Renders test.md (not under revision control) to an HTML fragment in test.html.
# Usage: ./test_render.sh [dark|light|print]

REPO_ROOT=$PWD
INPUT_MD="$REPO_ROOT/test.md"
OUTPUT_HTML="$REPO_ROOT/test.html"
THEME="${1:-dark}"

if [ ! -f "$INPUT_MD" ]; then
    echo "Error: $INPUT_MD not found. Create one as it's not under revision control."
    exit 1
fi

echo "Rendering $INPUT_MD using '$THEME' theme..."

if node "$REPO_ROOT/preview-engine/render-cli.js" --theme "$THEME" "$INPUT_MD" >"$OUTPUT_HTML"; then
    echo "Success: Generated $OUTPUT_HTML (HTML fragment)"
else
    echo "Error: Rendering failed."
    exit 1
fi
