#!/usr/bin/env bash
set -euo pipefail

echo "This script is a helper that shows the typical commands to extract Star Citizen data."
echo "Adjust paths and tools according to your environment."

# Example (pseudo):
# 1. Run scunpacked/unp4k to extract PAK/P4K files
#    ./unp4k -i /path/to/StarCitizen/Live -o /tmp/sc_unpacked
# 2. Convert extracted DB assets to JSON using community scripts
#    python3 scunpacked/tools/convert_to_json.py --input /tmp/sc_unpacked --out /tmp/sc_json
# 3. Copy generated JSON into the ship-stats data directory
#    cp /tmp/sc_json/ships.json /path/to/versecon-link/ship-stats/data/ships.json
#    cp /tmp/sc_json/items.json /path/to/versecon-link/ship-stats/data/items.json

echo "See README.md in the extractor folder for more details and links."
