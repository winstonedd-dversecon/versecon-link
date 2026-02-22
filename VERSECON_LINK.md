# VerseCon Link — Documentation & Agent Handoff

> **Last Updated**: 2026-02-22  
> **Version**: 2.10.44 (Electron)  
> **Purpose**: Desktop companion app that reads Star Citizen's `Game.log` in real-time, parses game events, and displays an in-game HUD overlay + dashboard.

---

## 📂 Game.log Source (CRITICAL)

> [!IMPORTANT]
> The **ONLY** source of truth for log data is the live `Game.log` on the user's **Windows gaming PC**:
>
> ```text
> C:\Program Files\Roberts Space Industries\StarCitizen\LIVE\Game.log
> ```
>
> This file is constantly updated while the game is running. The app tails it in real-time via `log-watcher.js`.

### Fetching the Latest Log (Dev)

```bash
# Quick fetch (requires SSH on Windows PC)
./fetch-log.sh

# Or set host first:
export VCON_WINDOWS_HOST=192.168.1.XXX
export VCON_WINDOWS_USER=damien
./fetch-log.sh
```

```powershell
# Manual copy (from Windows PowerShell, push TO dev machine):
scp "C:\Program Files\Roberts Space Industries\StarCitizen\LIVE\Game.log" damien@DEV_IP:~/versecon-link/Game.log
```

---

## 🏗️ Architecture Overview

```text
versecon-link/
├── package.json             # Electron app config
├── known-patterns.json      # Log pattern database (exportable)
├── fetch-log.sh             # Pull latest Game.log from Windows PC
├── VERSECON_LINK.md          # THIS FILE
├── MASTER_GUIDE.md           # Research findings & roadmap
├── Game.log                  # Symlinked / latest fetched log
└── src/
    ├── main/                 # Electron Main Process
    │   ├── main.js           # Entry point — windows, IPC, event wiring
    │   ├── log-watcher.js    # File tailing + LogEngine orchestration
    │   ├── api-client.js     # VerseCon API client (friend sharing)
    │   ├── update-manager.js # Auto-update via electron-updater
    │   └── parsers/          # Modular parser system (see below)
    │       ├── index.js      # LogEngine — registers + routes all parsers
    │       ├── navigation.js # Location, system, shard, quantum travel
    │       ├── session.js    # Session start/ID detection
    │       ├── vehicle.js    # Ship enter/exit, spawn points
    │       ├── hangar.js     # Hangar elevator states
    │       ├── combat.js     # Deaths, fire, destruction, INTERDICTION
    │       ├── mission.js    # Mission accept/status/objectives
    │       ├── inventory.js  # Equip/unequip tracking
    │       ├── economy.js    # Trade/economy tracking
    │       ├── social.js     # Player proximity detection
    │       └── custom.js     # User-defined regex patterns
    └── renderer/             # Electron Renderer (UI)
        ├── dashboard.html    # Main control panel (6 tabs)
        ├── overlay.html      # In-game HUD (transparent, always-on-top)
        ├── alert.html        # Full-screen critical event alerts
        └── audio-synth.js    # Web Audio API sound effects
```

---

## 🔄 Data Flow

```text
Game.log (file on disk, tailed by chokidar)
    ▼
LogWatcher (log-watcher.js)
  - Initial scan: async chunks of 500 lines (last N lines from config.initialScanLimit)
  - Live tail: reads new bytes on each file change event
    ▼
LogEngine (parsers/index.js)
  - Routes every line to ALL registered parsers simultaneously
  - Each parser emits 'gamestate' events upward to the engine
    ▼
main.js — listens for 'gamestate' events
  → Ship image resolution (fuzzy match against config.shipMap)
  → TTS voice alerts (SpeechSynthesis via dashboardWindow IPC)
  → Hue reactions (Phillips Hue light color flashes)
  → Pattern reactions (custom log rules)
  → TACTICAL_PROXIMITY alerts (interdiction ship detection)
  → broadcast() to ALL renderer windows
    ▼
Renderer Windows (overlay.html, dashboard.html, alert.html)
```

**Key IPC channels:**

- `log:update` — parsed gamestate events (location, ship, death, etc.)
- `log:raw-batch` — raw log lines batched @ 50ms intervals
- `settings:save` / `settings:updated` — config sync
- `app:tts` — TTS text → dashboardWindow speaks it
- `alert:trigger` — fires alert.html overlays

---

## 🎯 Parser System

### Registered Parsers

| Parser | File | Status | Events Emitted |
|--------|------|--------|----------------|
| **Navigation** | `navigation.js` | ✅ VERIFIED | `LOCATION`, `SYSTEM`, `SERVER_CONNECTED`, `ZONE`, `QUANTUM_*`, `NEW_LOCATION` |
| **Session** | `session.js` | ✅ VERIFIED | `SESSION_START`, `SESSION_ID`, `BUILD_INFO` |
| **Vehicle** | `vehicle.js` | ✅ VERIFIED | `SHIP_ENTER`, `SHIP_EXIT`, `SPAWN_SET` |
| **Hangar** | `hangar.js` | ✅ VERIFIED | `HANGAR_STATE` |
| **Combat** | `combat.js` | ✅ VERIFIED | `DEATH`, `VEHICLE_DESTRUCTION`, `STATUS`, `HAZARD_FIRE`, `INTERDICTION`, `TACTICAL_PROXIMITY` |
| **Mission** | `mission.js` | 🔬 RESEARCH | `MISSION_ACCEPTED`, `MISSION_STATUS`, `MISSION_OBJECTIVE`, `MISSION_CHANGED` |
| **Inventory** | `inventory.js` | ⚠️ UNVERIFIED | `ATTACHMENT_RECEIVED` |
| **Economy** | `economy.js` | ⚠️ UNVERIFIED | Trade/economy |
| **Social** | `social.js` | ✅ WORKS | `PLAYER_NEARBY`, `PLAYER_LEFT` |
| **Custom** | `custom.js` | ✅ WORKS | User-defined events |
| **Zone** | `zone.js` | ❌ DISABLED | Conflicts with `navigation.js` |

---

## 🌍 System & Location Detection (`navigation.js`)

### How It Works

The `navigation.js` parser detects location and system from two primary log patterns:

**1. Physical Location** — `RequestLocationInventory`:

```log
<RequestLocationInventory> Player[Name] requested inventory for Location[RR_HUR_LEO]
```

**2. System from Entity Names** — any entity/zone string is scanned for system keywords:

| System | Trigger Fragments |
|--------|------------------|
| **Pyro** | `pyro`, `pext`, `pyro-`, `p_` prefix |
| **Nyx** | `nyx`, `nyx-` |
| **Magnus** | `magnus`, `magnus-` |
| **Stanton** | `stanton`, `cru_`, `hur_`, `arc_`, `mic_`, `grimhex`, `orison`, `lorville`, `area18`, `newbabbage`, `stan-` |

> [!IMPORTANT]
> **Pyro takes priority over Stanton**. The code checks Pyro first to prevent misidentification. Jump point transit strings (`jumppoint`) are excluded from triggering system changes.

### Jump Point Transitions

Detected by tracking `OOC_JumpPoint_*` physics grid entries:

```log
CPhysicalProxy::OnPhysicsPostStep is trying to set position in the grid (OOC_JumpPoint_stanton_magnus)
```

The system emits `ZONE: Wormhole Transit` and suppresses system detection mid-jump to prevent flip-flopping.

---

## 🔥 Combat Parser (`combat.js`)

### Fire Detection (3-Layer Filter)

| Layer | Filter | Purpose |
|-------|--------|---------|
| **Pattern** | `<Fire Client - Snapshot Request>.*Similarity` | Only genuine fire on local player's ship |
| **Ship filter** | Cross-reference room name with manufacturer prefix | Suppress fires on other ships |
| **Cooldown** | 10 seconds | Prevent alert spam |

> [!NOTE]
> `Fire Client - Background Simulation Skipped` lines are **not** fires on your ship. They fire for ALL nearby ships and are used for **Interdiction Detection** instead (see below).

### Death & Vehicle Destruction

```log
<Actor Death> CActor::Kill: 'VictimName' [id] ...
killed by 'KillerName' [id] using 'WeaponName'
with damage type 'DamageType' from direction x:X, y:Y, z:Z
```

```log
<Vehicle Destruction> CVehicle::OnAdvanceDestroyLevel: Vehicle 'ANVL_Paladin_123' [id]
advanced from destroy level 0 to 1 caused by 'Attacker'
```

---

## ⚠️ Tactical Interdiction Detection (v2.10.44)

### How It Works

When Star Citizen loads any ship into your local simulation bubble, it logs fire area snapshots for all rooms on that ship:

```log
[Notice] <Fire Client - Background Simulation Skipped> Fire Area 'Room_Mantis_Cockpit-001' received a snapshot...
```

The `CombatParser` scans these lines against a configurable list of **interdictor ship name fragments**. A match fires a `TACTICAL_PROXIMITY` gamestate event.

### Default Ship List

Pre-loaded in `config.json` on first run:

| Fragment | Ship |
|----------|------|
| `Mantis` / `AEGS_Mantis` | RSI Mantis (Quantum Snare) |
| `Cutlass_Blue` / `DRAK_Cutlass_Blue` | Drake Cutlass Blue (law enforcement interceptor) |
| `Zeus_Sentinel` | Zeus Mk II Sentinel (planned interdictor) |
| `Antares` | Antares (scan/interdict platform) |

### Alert Flow

```
proximity_fire regex matches log line
    → Check ship fragment list (case-insensitive substring)
    → Check 60s per-ship cooldown
    → Check detection mode (quantumOnly vs always-on)
    → Emit TACTICAL_PROXIMITY { ship, room, inQuantum }
        → main.js: TTS "Warning. Mantis detected nearby."
        → main.js: Tray notification "⚠️ TACTICAL ALERT"
        → alert.html: tactical_proximity alert
```

### Quantum State Tracking

The `CombatParser` self-tracks quantum state by reading jump drive lines:

```log
<Jump Drive Requesting State Change> ... to Traveling    ← inQuantum = true
<Jump Drive Requesting State Change> ... to Idle         ← inQuantum = false
```

### Detection Mode Toggle

Configurable in **Settings → ⚠️ Interdiction Ship Detection**:

| Mode | Setting | Behaviour |
|------|---------|-----------|
| **Quantum Only** ✅ (default) | `interdictionQuantumOnly: true` | Alert only fires mid-jump. Zero false positives from passing/docking near an interdictor. |
| **Always On** | `interdictionQuantumOnly: false` | Alert fires any time an interdictor ship is in proximity. Useful for ambush awareness. |

### Managing the Ship List

In **Settings → ⚠️ Interdiction Ship Detection**:

- Type a ship name fragment (e.g. `Scorpius`) into the text box → **➕ Add**
- Click **✕** on a tag to remove it
- Changes apply **instantly** to the running parser (no restart required)
- Cooldowns reset when the list changes, so new ships trigger immediately

> [!TIP]
> Use the internal ship ID fragment, not the display name. Find it in your log by searching for `Room_` entries when a ship is nearby, e.g. `Room_Zeus_ES_Sentinel_Cockpit` → fragment is `Zeus_ES_Sentinel`.

---

## 📡 Inter-System Travel Tracking

### Wormhole Transit

Detected via physics grid transitions. When the player enters a jump point:

1. **Entry**: `OOC_JumpPoint_*` grid entry → `ZONE: Wormhole Transit`
2. **System lock**: System identification is suppressed during transit
3. **Arrival**: First entity placement in new system triggers correct system detection

### Verified Transition Log Signatures

```log
# Jump point grid entry
CPhysicalProxy::OnPhysicsPostStep is trying to set position in the grid (OOC_JumpPoint_stanton_magnus)

# Context established (new system loaded)
establisher="Network"...taskname="WaitRemoteState"...state=eCVS_InGame...status="Finished"

# Arrival verification (station inventory)
<RequestLocationInventory> Player[Name] requested inventory for Location[RR_JP_NyxCastra]

# Jump point relay station
<RequestLocationInventory> Player[Name] requested inventory for Location[RR_JP_Stanton_Magnus]
```

---

## 🖥️ Overlay HUD (`overlay.html`)

### Layout — Safe Zones

```
┌─────────────┬───────────────────────┬─────────────┐
│  ❌ BLOCKED  │  ✅ FLIGHT DECK HUD   │  ❌ BLOCKED  │
│ (QT markers)│  (Top Center — Safe)  │ (chat/party) │
├─────────────┴───────────────────────┴─────────────┤
│                                    ┌─────────────┐│
│                                    │ ✅ PARTY/FEED││
│  (game world)                      │ (Mid-Right) ││
│                                    └─────────────┘│
├─────────────────────────────────────────────────  ┤
│  ❌ BLOCKED  │                      │  ❌ BLOCKED  │
│ (health/O2)  │                      │ (ship HUD)   │
└─────────────┴──────────────────────┴─────────────┘
```

### HUD Modules (all toggleable in Settings)

| Module | Toggle ID | What it shows |
|--------|-----------|---------------|
| Top Bar | `hudTop` | System clock, shard, timer |
| Session Info | `sessionInfo` | Session duration, build |
| System Info | `systemInfo` | Current system (Stanton/Pyro etc.) |
| Ship Status | `shipStatus` | Current ship + image |
| Location/Zone | `locationZone` | Physical location + zone override |
| Right Panel | `rightPanel` | Party list, tactical feed |
| Ship Visualizer | `shipVisualizer` | 3D ship model preview |
| Chat HUD | `chatHud` | Twitch/YouTube stream chat |

### Accent Colors

Configurable in Settings → **Theme & Personalization**. Presets:

- 🟠 VCON Orange `#ffa500` (default)
- 🔵 Science Cyan `#00c8ff`
- 🔴 Combat Red `#ff2e63`
- 🟢 Medical Green `#22c55e`
- 🟣 Command Purple `#a855f7`

---

## 📢 Voice Alerts (TTS)

Announced via browser `SpeechSynthesisUtterance` through the dashboard window.

| Event | Announcement |
|-------|-------------|
| `SERVER_CONNECTED` | "Connected to shard {id}" |
| `MISSION_ACCEPTED` | "Mission accepted. {name}" |
| `SPAWN_SET` | "Spawn point set to {location}" |
| `HUD_WARNING` with "fire" | "Warning. Fire detected." |
| `INTERDICTION` | "Warning. Quantum interdiction detected." |
| `TACTICAL_PROXIMITY` | "Warning. {ShipName} detected nearby." |

Settings: **Settings → 📢 Voice Alerts (TTS)**

- Enable/disable toggle
- Voice selection dropdown (system voices)
- Volume slider (0–100%)
- Test button

---

## 💬 Stream Chat HUD

Displays live Twitch/YouTube chat messages in the overlay.

### Twitch

Connects via Twitch IRC WebSocket (`wss://irc-ws.chat.twitch.tv:443`) as an anonymous viewer (no OAuth required). Auto-reconnects after 10s on disconnect.

### YouTube

Polling-based. Enter the Live Video ID to link chat.

Settings: **Settings → Stream Integration**

- Twitch channel name input
- YouTube live video ID input
- Chat HUD visibility toggle

---

## 🗺️ Custom Locations

Used to name dynamically-generated locations (caves, mission sites, outposts) that have no static log entry.

### Adding a Custom Location

1. While at the location, the overlay shows the raw ID (e.g. `Cave_Unoccupied_Stanton1`)
2. Dashboard → **Settings → Custom Locations** → click **Grab from Log**
3. Add a human-readable name and optional zone override
4. Optionally assign a system (Stanton / Pyro)

### Zone Overrides

Force the HUD to display a specific zone type for a location:

- `Armistice Zone` — triggers Armistice alerts on entry/exit
- `Open Space` — space/asteroid field
- `Restricted Area` — military/restricted

Config stored in `config.json` under `customLocations`.

---

## 🎯 Custom Log Patterns

User-defined regex rules that fire `gamestate` events. Useful for tracking niche game events not covered by built-in parsers.

### Management (Settings → Custom Patterns)

- Add regex + friendly name + event type
- Test regex against a sample line inline
- Edit/delete existing patterns
- Built-in patterns can be **disabled** (but not deleted) with a toggle

### Pattern Database

**Log Database tab** shows all 75+ built-in patterns from 9 parsers:

- Filter by category, search by text
- Export/import as JSON (`known-patterns.json`)

---

## ⚙️ Performance & Optimization

| Setting | Default | Description |
|---------|---------|-------------|
| Performance Mode | `false` | Disables raw log feed UI to save CPU |
| Log History Limit | `200` | Max lines kept in raw log viewer |
| Initial Scan Depth | `5000` | Lines read from log tail on startup |
| Clear Log Feed | — | Immediately flushes the raw log queue |

> [!TIP]
> During long play sessions (4+ hours), the log can grow to 20K+ lines. Enable Performance Mode to prevent UI lag.

---

## 🔧 IPC Reference

| Channel | Direction | Payload | Description |
|---------|-----------|---------|-------------|
| `log:update` | Main → Renderer | `gamestate` object | Parsed game event |
| `log:raw-batch` | Main → Renderer | `string[]` | Raw log lines (batched) |
| `settings:save` | Renderer → Main | config partial | Save and apply config changes |
| `settings:updated` | Main → Renderer | full config | Broadcast config to all windows |
| `app:tts` | Main → Dashboard | `string` | Speak text via SpeechSynthesis |
| `alert:trigger` | Main → Alert | alert object | Trigger full-screen alert |
| `alert:show` / `alert:hide` | Renderer → Main | — | Show/hide alert window |
| `command:send` | Dashboard → Main | command object | Remote command relay |
| `app:login` | Dashboard → Main | token | VerseCon auth token |
| `app:tts` | Main → Dashboard | string | Trigger TTS speech |

---

## 🐛 Known Issues & Gotchas

### Active Limitations

1. **No `SetDriver` in SC 4.6** — Ship entry uses VOIP channel join, exit uses `ClearDriver`
2. **Mining/Salvage/Engineering parsers** — 100% speculative; never found in real logs
3. **`zone.js` disabled** — `navigation.js` now handles all zone state
4. **Cannot detect incoming damage** — Game.log only records results (death, fire, vehicle destroyed), not hit events
5. **NetworkWatcher** — TCP polling for shard latency only works on Windows
6. **Shard migration** — SC may reassign shards mid-session after initial `Join PU`
7. **YouTube Chat** — Fully server-side polling; YouTube Data API key improves reliability
8. **`Fire Client - Background Simulation Skipped`** — Appears for ALL nearby ships. Used for Interdiction Detection (by design), not a bug.

### Interdiction False Positive Prevention

The `proximity_fire` pattern fires for any ship in your simulation bubble, not just interdictor ships. Two mitigations are in place:

1. **Ship allowlist** — Only ships on the user's configured list trigger alerts
2. **Quantum-only mode** (default ON) — Alert only fires when `inQuantum === true`, preventing false positives from passing/docking near an interdictor ship in normal space

---

## 🔬 Verified Log Patterns (SC 4.6+)

### Ship Entry (VOIP join)

```log
You have joined channel 'Esperia Prowler Utility : TypicallyBrit_ish'
```

### Ship Exit (leaves pilot seat)

```log
<Vehicle Control Flow> CVehicle::ClearDriver: ...releasing control token for 'ESPR_Prowler_9448279551878'
```

### Physical Location

```log
<RequestLocationInventory> Player[Name] requested inventory for Location[RR_HUR_LEO]
```

### Shard / Server

```log
<Join PU> address[34.11.90.244] port[64307] shard[pub_use1b_11218823_110]
```

→ Parsed as `USE1B-110` (region + instance)

### Quantum Travel

```log
<Jump Drive Requesting State Change> ... to Traveling    ← start
<Jump Drive Requesting State Change> ... to Idle         ← end
```

### Jump Point Entry

```log
CPhysicalProxy::OnPhysicsPostStep is trying to set position in the grid (OOC_JumpPoint_stanton_magnus)
```

### Interdiction Ship (in simulation bubble)

```log
[Notice] <Fire Client - Background Simulation Skipped> Fire Area 'Room_Mantis_Cockpit-001' received a snapshot ahead of the current simulation by 0 steps
```

### Player Proximity (Social)

```log
<SubscribeToPlayerSocial> Subscribing to player 204269884415
<UnsubscribeFromPlayerSocial> Unsubscribing from player 204269884415
```

### Mission Location (dynamic POI)

```log
<GenerateLocationProperty> Generated Locations - ... locations: (Hurston Cave [3018817963] [Cave_Unoccupied_Stanton1])
```

### Actor Death

```log
<Actor Death> CActor::Kill: 'VictimName' [id] in zone 'location'
killed by 'KillerName' [id] using 'WeaponName' [Class X]
with damage type 'DamageType' from direction x: X, y: Y, z: Z
```

### Vehicle Destruction

```log
<Vehicle Destruction> CVehicle::OnAdvanceDestroyLevel: Vehicle 'ANVL_Paladin_123' [id]
in zone 'zone' driven by 'Driver' [id]
advanced from destroy level 0 to 1 caused by 'Attacker' [id]
```

---

## 📦 Dependencies

| Package | Purpose |
|---------|---------|
| `electron` ^28 | Desktop framework |
| `chokidar` ^3.5 | File watching (Game.log tail) |
| `axios` ^1.6 | HTTP client for VerseCon API |
| `socket.io-client` ^4.7 | Real-time VerseCon connection |
| `ws` | WebSocket client (Twitch IRC) |
| `express` | Local HTTP server (Remote Access) |
| `obs-websocket-js` ^5 | OBS integration |

---

## 🧪 Quick Commands

```bash
npm start                               # Launch app in Electron dev mode
npm run dist                            # Build distributable
./fetch-log.sh                          # Pull latest Game.log from Windows PC
node -c src/main/parsers/combat.js      # Syntax check any parser
grep -in "Mantis" Game.log              # Debug interdiction ship fire areas  
grep -in "Jump Drive" Game.log          # Debug quantum state tracking
grep -in "RequestLocationInventory" Game.log | tail -20  # Recent locations
```

---

## 📋 Changelog

### v2.10.44 (2026-02-22)

- **⚠️ Interdiction Ship Detection**: `proximity_fire` regex detects interdictor ships by their fire area room snapshots in the simulation bubble
- **Quantum State Tracking**: `CombatParser` self-tracks `inQuantum` from jump drive logs to gate interdiction alerts
- **Configurable Detection Mode**: "Quantum Only" (default) vs "Always On" toggle in Settings
- **Expandable Ship List**: UI panel in Settings for managing interdictor ship fragments (add/remove instantly, no restart)
- **TACTICAL_PROXIMITY event**: TTS voice alert + tray notification + alert window on interdictor detection

### v2.10.x (2026-02-20 → 2026-02-22)

- **Pyro/Stanton misidentification fix**: Pyro system detection now takes priority. Jump point transit strings excluded from system identification
- **Wormhole Transit zone**: Correctly emits `ZONE: Wormhole Transit` during jump point traversal
- **Stanton sub-region fallbacks**: `CRU_`, `HUR_`, `ARC_`, `MIC_` prefixes mapped to Stanton (fixes space stations like `RR_CRU_L1`)

### v2.10 (2026-02-16 → 2026-02-20)

- **Voice Alerts (TTS)**: SpeechSynthesis for critical game events. Volume, voice selection, test button
- **Stream Chat HUD**: Twitch IRC WebSocket + YouTube polling integration in overlay
- **HUD Accent Colors**: 5 color presets + custom hex picker
- **Overlay UI Toggles**: Each HUD module independently togglable in Settings
- **Log Performance Mode**: Disables raw log feed UI to reduce CPU usage. Configurable log history limit
- **Custom Locations v2**: System assignment (Stanton/Pyro), expanded zone types, improved auto-system detection
- **Stream Deck support**: REST API endpoints for hardware button integration
- **Hue Reactions**: Philips Hue light color responses to game events (fire, death, armistice, etc.)

### v2.7.2 (2026-02-20)

- Fire false positive fix (Background Simulation vs Snapshot Request)
- ShipElevator ASOP spam fix
- Stanton sub-region identification
- CrimeStat, Medical Respawn, ASOP tracking added
- Log Database now shows all 75+ built-in patterns

### v2.7.0 (2026-02-15)

- Ship image fuzzy matching + `file:///` protocol fix
- Custom location zone overrides
- Location overwrite false positive fix (GenerateLocationProperty)
- Armistice zone toggle spam fix
- Full-screen alert system (fire, death, vehicle destruction)
