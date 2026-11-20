#!/bin/bash
# Exports test.md (not under revision control) to test.pdf with the print theme.
# Usage: ./test_export.sh

REPO_ROOT=$PWD
INPUT_MD="$REPO_ROOT/test.md"
OUTPUT_PDF="$REPO_ROOT/test.pdf"

if [ ! -f "$INPUT_MD" ]; then
    echo "Error: $INPUT_MD not found. Create one as it's not under revision control."
    exit 1
fi

echo "Exporting $INPUT_MD to PDF..."
export PDF_FORMAT="A4"
export PDF_MARGIN="1cm"

if node "$REPO_ROOT/preview-engine/export-cli.js" "$INPUT_MD" "$OUTPUT_PDF"; then
    echo "Success: Generated $OUTPUT_PDF"
else
    echo "Error: PDF export failed."
    exit 1
fi
