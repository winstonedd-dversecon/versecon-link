# VerseCon Link — Agent Handoff Documentation

> **Last Updated**: 2026-02-15  
> **Version**: 2.7.0 (Electron)  
> **Purpose**: Desktop companion app that reads Star Citizen's `Game.log` in real-time, parses game events, and displays an in-game overlay + dashboard.

---

## 📂 Game.log Source (CRITICAL)

> [!IMPORTANT]
> The **ONLY** source of truth for log data is the live Game.log on the user's **Windows gaming PC**:
>
> ```
> C:\Program Files\Roberts Space Industries\StarCitizen\LIVE\Game.log
> ```
>
> This file is constantly updated while the game is running. Sample logs in `src/` are snapshots for development.

### Fetching the Latest Log

```bash
# Quick fetch (requires SSH on Windows PC — see fetch-log.sh for setup)
./fetch-log.sh

# Or set host first:
export VCON_WINDOWS_HOST=192.168.1.100
export VCON_WINDOWS_USER=damien
./fetch-log.sh

# Manual copy (from Windows PowerShell, push TO dev machine):
scp "C:\Program Files\Roberts Space Industries\StarCitizen\LIVE\Game.log" damien@DEV_IP:~/versecon-link/src/Game.log
```

The script auto-backs up the existing log with a timestamp, and prints a quick analysis (deaths, ships, locations, missions, fire sims).

---

## 🏗️ Architecture Overview

```text
versecon-link/
├── package.json             # Electron app config, v2.7.0
├── known-patterns.json      # Log pattern database (20+ patterns, exportable)
├── fetch-log.sh             # Pull latest Game.log from Windows PC
├── TRACKED_LOGS.md          # Regex pattern reference (keep in sync!)
├── VERSECON_LINK.md          # THIS FILE — agent handoff doc
├── MASTER_GUIDE.md           # Research findings & roadmap
├── src/
│   ├── Game.log              # Latest fetched log (use fetch-log.sh to update)
│   ├── Game (2).log          # Prowler session snapshot (6448 lines)
│   ├── main/                 # Electron Main Process
│   │   ├── main.js           # Entry point — windows, IPC, event wiring
│   │   ├── log-watcher.js    # File tailing + LogEngine orchestration
│   │   ├── api-client.js     # VerseCon API client (friend sharing)
│   │   ├── update-manager.js # Auto-update via electron-updater
│   │   ├── parsers/          # 15 parser modules (see below)
│   │   └── telemetry/        # Network watcher + telemetry engine
│   ├── renderer/             # Electron Renderer (UI)
│   │   ├── dashboard.html    # Main control panel (~125KB, 6 tabs)
│   │   ├── overlay.html      # In-game HUD overlay (transparent, always-on-top)
│   │   ├── alert.html        # Full-screen alert pop-ups (status, fire, death, destruction)
│   │   └── audio-synth.js    # Web Audio API sound effects
│   └── styles/               # CSS files
└── test/                     # Test files
```

---

## 🔄 Data Flow

```text
Game.log (file on disk)
    ▼
LogWatcher (log-watcher.js) — tails file, reads last 10K lines on startup
    ▼
LogEngine (parsers/index.js) — routes each line to ALL registered parsers
    ▼
main.js — listens for 'gamestate' events
  → Ship image resolution (fuzzy match config.shipMap BEFORE broadcast)
  → broadcast() to ALL renderer windows via IPC
    ▼
Renderer Windows (overlay.html, dashboard.html, alert.html)
```

**IPC channels**: `log:update` (parsed events), `log:raw-batch` (raw lines batched @ 50ms)

---

## 🎯 Parser System

### Registered Parsers (`parsers/index.js`)

| Parser | File | Status | Events Emitted |
| ------ | ---- | ------ | -------------- |
| **Navigation** | `navigation.js` | ✅ VERIFIED | `LOCATION`, `SERVER_CONNECTED`, `ZONE` |
| **Session** | `session.js` | ✅ VERIFIED | `SESSION_START` |
| **Vehicle** | `vehicle.js` | ✅ VERIFIED | `SHIP_ENTER`, `SHIP_EXIT`, `SPAWN_SET` |
| **Hangar** | `hangar.js` | ✅ VERIFIED | `HANGAR_STATE` (TRANSIT/READY/CLOSED) |
| **Combat** | `combat.js` | 🔬 RESEARCH | `DEATH`, `VEHICLE_DESTRUCTION`, `STATUS`, `HAZARD_FIRE` |
| **Mission** | `mission.js` | 🔬 RESEARCH | `MISSION_ACCEPTED`, `MISSION_STATUS`, `MISSION_OBJECTIVE`, `MISSION_CHANGED` |
| **Custom** | `custom.js` | ✅ WORKS | User-defined regex patterns |
| **Mining** | `mining.js` | ❌ SPECULATIVE | Never matched real logs |
| **Salvage** | `salvage.js` | ❌ SPECULATIVE | Never matched real logs |
| **Engineering** | `engineering.js` | ❌ SPECULATIVE | Never matched real logs |
| **Economy** | `economy.js` | ⚠️ UNVERIFIED | Trade/economy tracking |
| **Social** | `social.js` | ⚠️ UNVERIFIED | Friend detection |
| **Zone** | `zone.js` | ❌ DISABLED | Conflicts with `navigation.js` |

### Vehicle Parser — Dedup, Soft Exit & Ship Images

- **SHIP_ENTER**: Only matches `SHUDEvent_OnNotification` lines (avoids 3x duplicates from continuation/update lines). 5-second dedup timer for same ship.
- **SHIP_EXIT**: Fires on `ClearDriver` (leaving pilot seat). Does NOT clear `currentShip` — player may still be aboard. Overlay shows `🪑 Left Pilot Seat` and `ShipName (Aboard)`.
- **HANGAR_STATE**: Only from `hangar.js` (vehicle.js duplicate removed). Shows `🔄 ELEVATOR MOVING` / `✅ HANGAR OPEN`.
- **Ship Image Resolution**: Uses `findShipImage()` — fuzzy partial matching (case-insensitive, bidirectional substring). Map key `"Prowler"` matches detected name `"Esperia Prowler Utility"`. Falls back to `main.js` if parser didn't resolve (e.g., shipMap updated after parser init). Overlay converts paths to `file:///` protocol for Windows compatibility.

### Fire Detection (3-Layer Filter)

| Layer | Filter | Purpose |
| ----- | ------ | ------- |
| **Exclusion** | Skip `Background Simulation Skipped` + `fire_extinguisher` | Eliminates 1,000+ noise lines per session |
| **Pattern** | Match `Spread`, `Ignit`, `Cell Burning`, `Damage`, `Started`, `Warning` | Only real fire events |
| **Ship filter** | Cross-reference room name with 12 manufacturer prefixes | Suppress fires on OTHER ships when possible |
| **Cooldown** | 10-second minimum between alerts | Prevent spam |

Manufacturer prefixes checked: `mrai_`, `espr_`, `anvl_`, `orig_`, `misc_`, `cnou_`, `drak_`, `rsi_`, `aegs_`, `argo_`, `crusader_`, `banu_`

### Shard Display

Shard string `pub_use1b_11218823_110` parsed as: `USE1B-110` (region + instance). IP shown below.

### Verified Patterns (SC 4.6)

**SHIP ENTER** — VOIP Channel Join:

```log
You have joined channel 'Esperia Prowler Utility : TypicallyBrit_ish'
```

**SHIP EXIT** — ClearDriver (leaves pilot seat, NOT ship):

```log
<Vehicle Control Flow> CVehicleMovementBase::ClearDriver: ...releasing control token for 'ESPR_Prowler_Utility_9448279551878'
```

**LOCATION** — RequestLocationInventory:

```log
<RequestLocationInventory> Player[Name] requested inventory for Location[RR_HUR_LEO]
```

**SERVER/SHARD** — Join PU:

```log
<Join PU> address[34.11.90.244] port[64307] shard[pub_use1b_11218823_110]
```

### Research Patterns (awaiting live verification)

**ACTOR DEATH**:

```log
<Actor Death> CActor::Kill: 'VictimName' [id] in zone 'location'
killed by 'KillerName' [id] using 'WeaponName' [Class X]
with damage type 'DamageType' from direction x: X, y: Y, z: Z
```

**VEHICLE DESTRUCTION**:

```log
<Vehicle Destruction> CVehicle::OnAdvanceDestroyLevel: Vehicle 'ANVL_Paladin_123' [id]
in zone 'zone' driven by 'Driver' [id]
advanced from destroy level 0 to 1 caused by 'Attacker' [id]
```

**MISSION ENDED**:

```log
<MissionEnded> mission_id [UUID] - mission_state [MISSION_STATE_SUCCEEDED]
```

---

## 🖥️ Windows & UI

### Overlay (`overlay.html`)

- Transparent, always-on-top, positioned in **Top Center** safe zone
- "Flight Deck" HUD: Location, Ship, Shard (USE1B-110 format), Timer (auto-starts)
- Tactical Feed: Ship enter/exit, deaths, vehicle destruction, missions, zones, quantum
- Alert popups for: death, fire, mission fail, ship destroyed

### Dashboard (`dashboard.html`)

- Main control panel (~125KB, 6 tabs: Dashboard, VerseCon Feed, Command, Settings, Players, Log Database)
- Live log viewer (click line to copy), Ship Image Manager, Custom Locations, Custom Patterns
- Alert cooldown settings, Connection status
- **Log Database** (v2.7): Browse/search/filter all known SC log patterns, add/edit/delete with inline regex tester, export/import JSON

### Alert Window (`alert.html`)

- Full-screen vignette + border flash effects for critical events
- **Supported alerts**: `status` (death/suffocating), `zone` (armistice enter/leave), `fire` (🔥 engineering), `killed` (☠️ actor death), `vehicle_destroyed` (💥 ship lost), `vehicle_crippled` (⚠️ critical damage)

### Overlay Safe Zones (DO NOT BLOCK)

- **Top-left**: Quantum markers, mission waypoints
- **Top-right**: Chat window, party list
- **Bottom-left**: Player status (health, O2)
- **Bottom-right**: Ship HUD, weapons
- **Safe**: Top-center (Flight Deck), Middle-right (lists/feed)

---

## 🐛 Known Issues & Gotchas

### Fixed (2026-02-20 — v2.7.1)

1. **Hue Settings Persistence wiped**: Initial load of the dashboard saved blank config items over existing Philips Hue config. **Fix**: `config.json` is broadcasted immediately on `did-finish-load` via `settings:updated` IPC, populating the UI before any settings can be overridden.
2. **Log Stream scrolling disrupted**: **Fix**: Changed from `.prepend` to `.appendChild` and introduced an auto-scroll anchor that respects active scrolling.
3. **Unknown Log batching delay**: **Fix**: Switched to emit unknown logs immediately on the first occurrence instead of batching them.
4. **Fast Log Drops (Gun Triggers failing)**: Rapidly written logs were split midpoint by `fs.watchFile` streams, invalidating regex sequences mid-line. **Fix**: Added a persistent `this.tailBuffer` in `log-watcher.js` to hold incomplete line fragments between polling intervals.
5. **Outpost & Bunker detection failing**: Outposts didn't map cleanly via the `Location[]` variables. **Fix**: Hooked the `LoadingPlatformManager` regex to grab location hints, and overhauled `cleanLocationName()` to nicely format strings like `Pyro4_Outpost_col_m_trdpst_indy_001` to "Pyro Trading Post Outpost".
6. **Custom Patterns not editable**: Users had to delete and recreate rules. **Fix**: Added inline "✏️ Edit" button to `dashboard.html` that repopulates the input form and executes an inline array update rather than appending.
7. **App Startup Frozen/UI Blocked**: The app took several seconds to open. **Fix**: Identified `log-watcher.js` synchronously parsed 5,000 lines on boot. Refactored this to read via `fs.promises` and process lines in asynchronous chunks of 500, unblocking the event loop and allowing the UI to render instantly.

### Fixed (2026-02-15 — v2.7)

1. **Ship image not loading** — `broadcast()` was called BEFORE ship image resolution, so overlay never received `data.image`. **Fix**: Moved image lookup before broadcast + fuzzy matching + `file:///` protocol conversion.
2. **Grab button broken** — Referenced wrong IDs (`new-loc-raw` → `new-loc-key`). **Fixed**.
3. **Custom locations not syncing to overlay** — No listener existed. **Fix**: Added `settings:custom-locations-updated` IPC + `dataset.raw` tracking.
4. **Full-screen alerts missing** — `alert.html` only handled status/zone. **Fix**: Added `HAZARD_FIRE`, `DEATH`, `VEHICLE_DESTRUCTION` alert configs.
5. **Unknown log text unreadable** — `0.65rem`/dim color. **Fix**: `0.8rem`/`#bbb`.

### Fixed (2026-02-14)

1. **VOIP duplicate SHIP_ENTER** — 3+ log lines per join. **Fix**: `SHUDEvent_OnNotification` filter + 5s dedup.
2. **False "Exited Vehicle"** — ClearDriver = left seat, not ship. **Fix**: `🪑 Left Pilot Seat` + `(Aboard)`.
3. **"Hangar Opendible"** — Raw state names displayed. **Fix**: `hangar.js` single source with readable labels.
4. **Session timer frozen** — Needed `SESSION_START`. **Fix**: Auto-starts on load.
5. **Shard display** — Wrong numeric ID. **Fix**: `USE1B-110` format.
6. **IP not shown** — Wrong element ID. **Fixed**.
7. **Missing overlay events** — Added: `DEATH`, `VEHICLE_DESTRUCTION`, `MISSION_*`.
8. **Fire false positives** — Matched 1,000+ Background Simulation lines. **Fix**: 3-layer filter + ship prefix matching.

### Persistent Issues

1. **No `SetDriver` in SC 4.6** — Ship entry uses VOIP, exit uses ClearDriver
2. **Mining/Salvage/Engineering** — 100% speculative, never found in real logs
3. **Zone parser disabled** — `zone.js` commented out, `navigation.js` handles zones
4. **Discover Groups button** — Links to non-existent `versecon.space/groups`
5. **Log extraction** — Only extracts locations from log clicks, not other events
6. **NetworkWatcher** — TCP polling only works on Windows
7. **Shard migration** — SC may reassign shards after initial `Join PU`

---

## 📦 Dependencies

| Package | Purpose |
| ------- | ------- |
| `electron` ^28.1.0 | Desktop framework |
| `tail` ^2.2.6 | File tailing for Game.log |
| `chokidar` ^3.5.3 | File system watching |
| `axios` ^1.6.5 | HTTP client for VerseCon API |
| `socket.io-client` ^4.7.4 | Real-time VerseCon connection |
| `obs-websocket-js` ^5.0.5 | OBS integration |

---

## 🧪 Quick Commands

```bash
npm start                    # Launch app in Electron
npm run dist                 # Build distributable (electron-builder)
./fetch-log.sh               # Pull latest Game.log from Windows PC
node -c src/main/parsers/combat.js  # Syntax check any parser
```

**Sample logs**: `src/Game.log` (latest), `src/Game (2).log` (Prowler session snapshot)

---

## 📦 Log Pattern Database (`known-patterns.json`)

A JSON catalog of all known/verified SC log patterns. Managed via:

- **Dashboard**: Log Database tab (search, filter, add/edit, inline regex tester)
- **Agent**: Edit `known-patterns.json` directly
- **Export**: Dashboard → 📤 Export → saves `.json` file
- **Import**: Dashboard → 📥 Import → merges by pattern ID (no duplicates)

Each pattern has: `id`, `category`, `name`, `status` (verified/research), `regex`, `example`, `event`, `notes`, `addedBy`, `addedDate`.

IPC channels: `patterns:load`, `patterns:save`, `patterns:add`, `patterns:update`, `patterns:delete`, `patterns:export`, `patterns:import`.
