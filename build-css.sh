#!/bin/bash
# Build script: reads main.css, minifies via Toptal API, injects into main.js style.textContent.
#
# Usage: ./build-css.sh
#
# Requires: curl, sed

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$SCRIPT_DIR/dist"
CSS_FILE="$DIST_DIR/main.css"
JS_FILE="$DIST_DIR/main.js"
TMP_CSS="$DIST_DIR/.minified.tmp"
TMP_JS="$DIST_DIR/.main.js.tmp"

if [ ! -f "$CSS_FILE" ]; then
    echo "Error: $CSS_FILE not found"
    exit 1
fi

if [ ! -f "$JS_FILE" ]; then
    echo "Error: $JS_FILE not found"
    exit 1
fi

ORIGINAL_SIZE=$(wc -c < "$CSS_FILE" | tr -d ' ')
echo "Minifying CSS ($ORIGINAL_SIZE bytes)..."

# Minify via Toptal API
HTTP_CODE=$(curl -s -X POST \
    --data-urlencode "input@$CSS_FILE" \
    -o "$TMP_CSS" -w "%{http_code}" \
    https://www.toptal.com/developers/cssminifier/api/raw)

if [ "$HTTP_CODE" != "200" ] || [ ! -s "$TMP_CSS" ]; then
    echo "Error: API returned HTTP $HTTP_CODE"
    cat "$TMP_CSS" 2>/dev/null
    rm -f "$TMP_CSS"
    exit 1
fi

MINIFIED_SIZE=$(wc -c < "$TMP_CSS" | tr -d ' ')
echo "Minified: $MINIFIED_SIZE bytes ($(( (ORIGINAL_SIZE - MINIFIED_SIZE) * 100 / ORIGINAL_SIZE ))% reduction)"

# Strategy: split main.js at style.textContent = '...' and reassemble
# 1. Find the line number containing style.textContent
LINE_NUM=$(grep -n "style.textContent" "$JS_FILE" | head -1 | cut -d: -f1)

if [ -z "$LINE_NUM" ]; then
    echo "Error: style.textContent not found in main.js"
    rm -f "$TMP_CSS"
    exit 1
fi

# 2. Read that line and split at style.textContent = '...'
#    The line has: ...style.textContent = '\n...\n', ...
#    We need to replace everything between the first ' after style.textContent = and the next '

# Get everything before style.textContent = '
BEFORE=$(sed -n "${LINE_NUM}p" "$JS_FILE" | sed "s/style\.textContent = '.*'/style.textContent = 'CSS_PLACEHOLDER'/")

# Build the new JS file:
# - Lines before the target line (unchanged)
# - The target line with CSS replaced
# - Lines after the target line (unchanged)

{
    # Lines before
    if [ "$LINE_NUM" -gt 1 ]; then
        sed -n "1,$((LINE_NUM - 1))p" "$JS_FILE"
    fi

    # Target line: replace content between style.textContent = '...'
    MINIFIED_CONTENT=$(cat "$TMP_CSS")
    sed -n "${LINE_NUM}p" "$JS_FILE" | sed "s|style\.textContent = '.*'|style.textContent = '\\\n${MINIFIED_CONTENT}\\\n'|"

    # Lines after
    TOTAL_LINES=$(wc -l < "$JS_FILE" | tr -d ' ')
    if [ "$LINE_NUM" -lt "$TOTAL_LINES" ]; then
        sed -n "$((LINE_NUM + 1)),\$p" "$JS_FILE"
    fi
} > "$TMP_JS"

if [ -s "$TMP_JS" ]; then
    mv "$TMP_JS" "$JS_FILE"
    echo "CSS injected into main.js successfully"
else
    echo "Error: Generated file is empty, aborting"
    rm -f "$TMP_JS"
    exit 1
fi

rm -f "$TMP_CSS"
