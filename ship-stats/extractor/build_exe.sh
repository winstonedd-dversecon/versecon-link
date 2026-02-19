#!/usr/bin/env bash
set -euo pipefail

echo "Build a single-file executable using PyInstaller"
echo "Install pyinstaller first: pip install pyinstaller"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v pyinstaller >/dev/null 2>&1; then
  echo "pyinstaller not found. Install with: pip install pyinstaller"
  exit 2
fi

pyinstaller --onefile extractor.py --name versecon_extractor

echo "Executable available in dist/versecon_extractor (or dist/versecon_extractor.exe on Windows)"
