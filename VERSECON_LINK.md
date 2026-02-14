# VerseCon Link — Agent Handoff Documentation

> **Last Updated**: 2026-02-14  
> **Version**: 2.4.0 (Electron)  
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
├── package.json             # Electron app config, v2.4.0
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
│   │   ├── dashboard.html    # Main control panel (104KB)
│   │   ├── overlay.html      # In-game HUD overlay (transparent, always-on-top)
│   │   ├── alert.html        # Full-screen alert pop-ups
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
main.js — listens for 'gamestate' events, broadcasts to ALL renderer windows via IPC
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

### Vehicle Parser — Dedup & Soft Exit

- **SHIP_ENTER**: Only matches `SHUDEvent_OnNotification` lines (avoids 3x duplicates from continuation/update lines). 5-second dedup timer for same ship.
- **SHIP_EXIT**: Fires on `ClearDriver` (leaving pilot seat). Does NOT clear `currentShip` — player may still be aboard. Overlay shows `🪑 Left Pilot Seat` and `ShipName (Aboard)`.
- **HANGAR_STATE**: Only from `hangar.js` (vehicle.js duplicate removed). Shows `🔄 ELEVATOR MOVING` / `✅ HANGAR OPEN`.

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

- Main control panel (104KB)
- Live log viewer (click line to copy), Ship Image Manager, Custom Locations, Custom Patterns
- Alert cooldown settings, Connection status

### Overlay Safe Zones (DO NOT BLOCK)

- **Top-left**: Quantum markers, mission waypoints
- **Top-right**: Chat window, party list
- **Bottom-left**: Player status (health, O2)
- **Bottom-right**: Ship HUD, weapons
- **Safe**: Top-center (Flight Deck), Middle-right (lists/feed)

---

## 🐛 Known Issues & Gotchas

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
