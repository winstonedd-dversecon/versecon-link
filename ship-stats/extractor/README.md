Game package extractor notes

This folder documents how to extract canonical in-game stats from your local Star Citizen installation.

Recommended tools:

- unp4k / scunpacked (community tools) — unpack .p4k/.pak files from the game
- scdatatools or community scripts to convert game DB tables into JSON

Basic steps (manual):

1. Install `unp4k`/`scunpacked` per their instructions on GitHub.
2. Run the unpacker against your local game folder to extract `DB`/`json` assets.
3. Use the provided scripts in community repos (e.g., scunpacked) to create `ships.json` and `items.json`.

Automation: create a script that runs the unpacker and copies the generated JSON into `versecon-link/ship-stats/data/`.

Note: unpacking requires local game files and may take disk space/time. Keep snapshots per LIVE/PTU as needed.
