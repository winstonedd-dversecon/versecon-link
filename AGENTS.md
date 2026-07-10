# VerseCon Link - Agent Context

## What It Is
Electron desktop companion app for Star Citizen that reads `Game.log` in real-time, parses events, and displays a transparent in-game overlay HUD + dashboard.

## Version
2.11.29 (Electron 28, Node.js)

## Tech Stack
- **Runtime:** Electron (main + renderer processes)
- **Backend parsers:** Node.js, chokidar (file watcher), tail (log tailing)
- **UI:** HTML/CSS/JS overlay windows (transparent, click-through)
- **Network:** ws (WebSocket), express, socket.io-client, nat-upnp
- **Integrations:** obs-websocket-js, tesseract.js (OCR), screenshot-desktop, axios, electron-updater

## How It Works
1. `log-watcher.js` tails Game.log, filters noise (CryAnimation, CryAction, Vulkan, etc.)
2. Each line is fed to modular parsers in `src/main/parsers/` (17 parsers: navigation, combat, vehicle, mission, inventory, economy, mining, salvage, engineering, session, social, zone, hangar, blueprint, custom, base, index)
3. Parsed events are broadcast via IPC to overlay windows and WebSocket to tablet/remote clients
4. Alert system triggers TTS, audio, fullscreen warnings, Philips Hue lights

## Parsers & What They Read
- **navigation.js** - Player location, quantum jumps, server connection, room names
- **vehicle.js** - Ship boarding/exiting via VOIP channel changes
- **combat.js** - Actor death (victim, killer, weapon, damage type), helmet state, suffocation
- **inventory.js** - Item attachments, freight/storage transfers
- **mission.js** - Contract accepted/completed/failed, active objective updates
- **economy.js** - Transactions, shop purchases, insurance claims, fines
- **session.js** - Build version, session ID, game start/end
- **social.js** - Player interactions
- **zone.js** - Armistice zones, jurisdiction
- **mining.js / salvage.js / engineering.js** - Speculative/fake parsers (these events don't exist in real logs)
- **blueprint.js** - Item/blueprint matching for run tracker

## Known Issues (from audit)
- Combat parser regex was wrong format (real format uses `<Actor Death>` with different schema)
- Mission parser patterns didn't match real 4.x log format
- Vehicle destruction parser missing
- Mining/Salvage/Engineering parsers are 100% speculative (never found in real logs)
- App was never successfully launched/run as of Feb 2026 audit

## Build & Run
- `npm install` then `npm start` (launches Electron)
- `npm run build:fast` for quick Windows build
- `npm run serve-loadout` for loadout API server
- `npm run build-data-index` to rebuild item data index

## Overlay Windows
- `overlay.html` - Transparent HUD (ship status, location, threats, chat)
- `dashboard.html` - Main settings + log viewer
- `alert.html` - Fullscreen HUD warnings
- `cnc.html` - Command & control overlay
- `squad-hud.html` - Squad HUD
- `tablet.html` - Local tablet dashboard
- `remote.html` - Remote control via WebSocket
- `ocr-debug.html` - OCR debugging

## Key Config
- Config stored at Electron `userData/config.json`
- Supports Twitch IRC chat, YouTube live chat polling
- Squad sync via WebSocket P2P (port 55100, UPnP)
- OCR via screenshot-desktop + Tesseract.js
- Auto-update via GitHub releases (owner: winstonedd-dversecon, repo: .gemini)

## Files to Remember
- `src/main/main.js` - Electron main process (all IPC, windows, services)
- `src/main/log-watcher.js` - File watcher + noise filter
- `src/main/parsers/` - All 17 parser modules
- `data/items.json` - Master item database
- `data/blueprints.json` - Blueprint definitions
- `data/blueprint-masterlist-full.json` - Full blueprint list
