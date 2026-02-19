# versecon-ship-stats

Minimal tools for versecon-link:

- `server.js` — serves static `ships.json` and `items.json` and current loadout
- `watcher.js` — tails Star Citizen `Game.log` and maintains `loadout.json`

Setup

1. Install dependencies:

```bash
cd versecon-link/ship-stats
npm install
```

2. Run the server (serves sample data):

```bash
npm start
# server on http://localhost:3000
```

3. Run the Game.log watcher (configure path via `GAME_LOG` env):

```bash
GAME_LOG="/path/to/Game.log" npm run watch
```

Extractor

See `extractor/README.md` for notes on unpacking game files (unp4k/scunpacked).

Extractor app

- The extractor CLI is at `extractor/extractor.py`.
- To copy pre-extracted JSON into the server data directory:

```bash
python3 extractor/extractor.py --input-json-dir /path/to/extracted/json
```

- To run the extractor as a small server exposing the JSON:

```bash
python3 extractor/extractor.py --input-json-dir /path/to/extracted/json --serve
# serves on http://127.0.0.1:4000 by default
```

- To build an executable (one-file) on your machine using PyInstaller:

```bash
# install pyinstaller in your Python env
pip install pyinstaller
# run the build helper (will produce dist/versecon_extractor)
bash extractor/build_exe.sh
```
