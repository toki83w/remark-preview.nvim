#!/bin/bash

# Configuration
REPO_ROOT=$PWD
export ENGINE_PATH="$REPO_ROOT/preview-engine"
REMARK_BIN="$ENGINE_PATH/node_modules/.bin/remark"
REMARK_CONFIG="$ENGINE_PATH/remarkrc.js"

INPUT_MD="$REPO_ROOT/test.md"
OUTPUT_HTML="$REPO_ROOT/test.html"
THEME="${1:-dark}" # Default to dark if no arg provided

if [ ! -f "$INPUT_MD" ]; then
    echo "Error: $INPUT_MD not found. Create one as it's not under revision control."
    exit 1
fi

echo "Rendering $INPUT_MD using '$THEME' theme..."

# Setup environment for remarkrc.js
export PREVIEW_THEME="$THEME"
export DOC_DIR="$REPO_ROOT"

"$REMARK_BIN" "$INPUT_MD" \
    --rc-path "$REMARK_CONFIG" \
    --output "$OUTPUT_HTML"

if [ $? -eq 0 ]; then
    echo "Success: Generated $OUTPUT_HTML"
else
    echo "Error: Rendering failed."
    exit 1
fi
