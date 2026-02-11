#!/bin/bash

REPO_ROOT=$PWD
ENGINE_DIR="$REPO_ROOT/preview-engine"
EXPORT_SCRIPT="$ENGINE_DIR/export.js"

TEMP_HTML="$REPO_ROOT/test.html"
OUTPUT_PDF="$REPO_ROOT/test.pdf"

# 1. Invoke the renderer with 'print' style
./test_render.sh print

if [ $? -ne 0 ]; then
    echo "Error: Rendering step failed. Aborting export."
    exit 1
fi

# 2. Convert the generated HTML to PDF
echo "Exporting to PDF..."
export PDF_FORMAT="A4"
export PDF_MARGIN="1cm"

node "$EXPORT_SCRIPT" "$TEMP_HTML" "$OUTPUT_PDF"

if [ $? -eq 0 ]; then
    echo "Success: Generated $OUTPUT_PDF"
else
    echo "Error: PDF export failed."
    exit 1
fi
