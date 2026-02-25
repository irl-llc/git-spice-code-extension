#!/usr/bin/env bash
# Validates that the vsix package contains all required files.
# Run after `npm run package` to catch missing assets before deployment.

set -euo pipefail

REQUIRED_FILES=(
  "dist/extension.js"
  "dist/stackView.js"
  "dist/codicons/codicon.css"
  "dist/codicons/codicon.ttf"
  "media/stackView.css"
  "media/stackView.html"
  "package.json"
  "icon.png"
)

echo "Listing package contents via vsce..."
PACKAGE_LIST=$(npx vsce ls 2>/dev/null)

MISSING=0
for file in "${REQUIRED_FILES[@]}"; do
  if echo "$PACKAGE_LIST" | grep -Fxq "$file"; then
    echo "  OK: $file"
  else
    echo "  MISSING: $file"
    MISSING=$((MISSING + 1))
  fi
done

if [ "$MISSING" -gt 0 ]; then
  echo ""
  echo "FAIL: $MISSING required file(s) missing from package."
  exit 1
fi

echo ""
echo "PASS: All required files present in package."
