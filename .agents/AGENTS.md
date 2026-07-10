# Project Rules & Telemetry Learnings

This document records critical implementation details, log parsing formats, and HUD behavior rules for the Star Citizen telemetry engine (`versecon-link`) to ensure these details are permanently preserved.

## 1. Helmet Warning Indicator
- **State Logic**: Check `Armor_Helmet` actor port attachment.
- **Port Deduplication**: Deduplicate unique item IDs across ports. If an attachment ID moves to a different port, delete it from the old port (so a helmet moving to `weapon_attach_hand_left` or `helmethook_attach` is cleared from `Armor_Helmet`).
- **Events**: Emit `{ type: 'HELMET_STATE', value: 'ON' }` if `Armor_Helmet` is populated, otherwise `'OFF'`.
- **Clean Slate**: On player death (`DEATH`), game join (`GAME_JOIN`), or spawning (`SPAWN_SET`), clear attachments and emit `HELMET_STATE = 'OFF'`.
- **UI HUD Warning**: Render a flashing amber warning column (`col-helmet` with text `⚠️ NO HELMET`) on the HUD overlay when `HELMET_STATE === 'OFF'`.

## 2. Quantum Travel Mode
- **Spooling vs Traveling**: Spooling or calculating route (`Successfully calculated route to`) must NOT trigger `IN QUANTUM` or `TRANSIT` states on the HUD overlay.
- **Traveling trigger**: Only trigger the quantum overlay transition (e.g. `IN QUANTUM`) when the jump drive state change traveling log pattern matches (`<Jump Drive Requesting State Change>.*to Traveling`). Spooling events emit `{ type: 'QUANTUM', value: 'spooling' }`, while traveling emits `{ type: 'QUANTUM', value: 'entered' }`.

## 3. Mission Completed / Contract Notifications
- **Log Structures**: Parse both MobiGlas/SHUDEvent (`Added notification "..."`) and comms notification updates (`<UpdateNotificationItem> Notification "..." [ID], Action: ...`).
- **regex Patterns**:
  - Accepted: `/(?:Added notification "Contract Accepted:\s*|Notification "Contract Accepted:\s*)([^"]+)"/i`
  - Completed: `/(?:Added notification "Contract Complete[d]?:\s*|Notification "Contract Complete:\s*)([^"]+)"/i`
  - Failed: `/(?:Added notification "Contract Failed:\s*|Notification "Contract Failed:\s*)([^"]+)"/i`
- **Formatting**: Trim trailing colons (e.g., `: `) from parsed mission titles on accept, completion, or failure.

## 4. Custom Location Mapping
- **Fuzzy Prefix Matching**: Use prefix/startsWith matching for custom locations to match hangars, lobbies, elevator shafts, and landing pads that start with the location key.
- **Typo Normalization**: Normalise common typos like `asteriod` to `asteroid` in both keys and logs to seamlessly resolve spelling mismatches (e.g. `TheCollectorsAsteriod_Stanton2` matching `TheCollectorsAsteroid_Stanton2`).
- **Toast Suppression**: Do not emit or flash the new/unmapped location toast if the raw location starts with or fuzzy-matches an existing custom location key.

## 5. Custom Weapon Alerts
- **Ammo Logs Bypass**: Bypass custom weapon pattern alerts on `AttachmentReceived` logs if the port matches `magazine_` or `ammo_` or includes `_mag` (unless the custom pattern regex explicitly mentions ammo keywords like `mag`, `ammo`, `bullet`, `magazine`).

## 6. GenerateLocationProperty — Friendly Name Extraction
- **Log Pattern**: `<GenerateLocationProperty> Generated Locations - variablename: ... locations: (FriendlyName [numericId] [RawCode])(...)(...)`.
- **Parser** (`navigation.js`): The `generated_location` regex captures the entire locations block. Use `matchAll` with `/\(([^[]+?)\s*\[\d+\]\s*\[([^\]]+)\]\)/g` to extract **all** `(FriendlyName [ID] [RawCode])` pairs — do NOT only capture the first pair.
- **Events emitted**:
  - `{ type: 'LOCATION_NAME_HINT', value: { rawCode: friendlyName, ... } }` — the `value` is a plain object mapping raw codes to their player-visible names (e.g. `TheCollectorsAsteriod_Stanton2` → `Wikelo Emporium Kinga Station`).
  - `{ type: 'NEW_LOCATION', value: rawCode }` — one per entry, for the location sniffer queue.
- **Typo normalization**: Also store normalised versions of raw codes (e.g. `Asteriod` → `Asteroid`) as additional keys in the hint map so fuzzy matching works.
- **Dashboard**: `locationNameHints` (global `{}`) accumulates hints from `LOCATION_NAME_HINT` events. `updateLocationSuggestion(raw)` checks `locationNameHints[raw]` **first** (Priority 1) before falling back to regex-based CamelCase splitting (Priority 2). Never remove this two-priority logic.
- **"Wikelo" in combat.js**: The string "Wikelo Emporium Dasi Station" appearing in a comment at `combat.js:368` is intentional — it is a real Star Citizen clinic location used as a code example, not a bug.

## 7. Run Tracker Tab
- **Nav item**: `id="nav-runtracker"`, `onclick="switchTab('runtracker')"`, emoji 🎯, placed between Blueprints and Overlay in the sidebar. Has an orange `<span class="badge" id="run-tracker-badge">` showing remaining item count.
- **Panel**: `id="view-runtracker"` — split layout: left = item browser, right = active run checklist.
- **Data source**: Loaded via `ipcRenderer.invoke('blueprints:get-master-list')` which calls `loadBlueprintData().masterList` in `main.js` — returns all 1,534 items from `data/blueprint-masterlist-full.json`.
- **Wikelo filter**: Category chip `data-cat="__wikelo__"` filters to items where `source.toLowerCase().includes('wikelo')`. Do NOT remove this special-case filter.
- **Item browser cap**: Renders max 200 results at a time with a count label. This is intentional for performance.
- **Run state**: `rtRun[]` array of `{ name, source, category, archKeyword, needed, collected, objectives }`. Persisted to `config.activeRun` via `ipcRenderer.send('settings:save', { activeRun: ... })`. Restored on `loadRunTracker()` from `config.activeRun`.
- **Item Stacking & Consolidation**: Consolidate similar items by matching `name.toLowerCase()`. Store individual mission/blueprint requirements under `objectives` (e.g., `{ 'Craft: ...': { needed, collected } }`). Recalculate totals (`needed`, `collected`) as the sum of all sub-objectives, and join keys with `' / '` to form the combined `source` string.
- **Manual Adjustments & Log Auto-detection**: When manual updates (`rtAdjust`) or log auto-detection (`handleRTAttachment`) increment collected counts, distribute the updated collected amount across the sub-objectives sequentially.
- **HUD Overlay Display**: Render the active Run Tracker progress bar, items checklist, and their active mission/blueprint sources underneath each item layout on the right sidebar HUD overlay widget (`#module-runtracker`). Do not hide these details or revert this presentation style.
- **Row flash**: On match, the `rt-row-${i}` div gets class `flash` (CSS animation) and a dashboard feed entry is added. The `playSound('collect')` call fires if sounds are enabled.
- **`settings:save` handler** (`main.js`): MUST include `if (newConfig.activeRun !== undefined) config.activeRun = newConfig.activeRun;` — do not remove this line.
- **`blueprints:get-master-list` IPC handle** (`main.js`): Must remain registered. It is separate from `blueprint:get-data` (which also returns collection state). Run Tracker only needs the master list.

## 8. HUD Overlay Click-Through
- **Problem**: The overlay panels had `.interactive` CSS class which set `pointer-events: auto`. The `mousemove` handler was checking `.closest('.interactive')` on any ancestor, causing panel backgrounds to block game clicks.
- **Fix**: The `mousemove` handler on the overlay window only sets `active: true` (disabling click-through) when the hovered element is an **actual interactive control**: `button`, `a`, `input`, `select`, `textarea`, or elements with `data-clickable` attribute or `drag-handle` class. Panel container divs with `.interactive` must NOT trigger active mode — only the control elements within them should.
- **Do not revert** this to checking `.closest('.interactive')` on the hovered element's ancestor chain.

## 9. Version History (key releases)
| Version | Key Changes |
|---------|-------------|
| 2.11.0  | Initial HUD click-through fix attempt |
| 2.11.1  | Click-through fixed properly; location auto-advance in sniffer fixed; `GenerateLocationProperty` friendly name extraction added |
| 2.11.2  | **Run Tracker** tab added (🎯); Wikelo filter chip; auto-detection via `AttachmentReceived` log matching |
| 2.11.3  | Support for Wikelo gather mission objectives log parsing and auto-tracking items in Run Tracker checklist; track ingredients instead of final item when selecting blueprints to craft; `🎯 Track` button on Blueprints tab. |
| 2.11.4  | Show ingredients needed for blueprints inline in both Item Database browser and Blueprints tab before tracking; merge seed curated blueprints to allow Wikelo items in Run Tracker; fix race condition in gather objectives. |
| 2.11.5  | Exclude inventory items, armor, weapons, and helmets from generic location parsing to keep the Custom Locations sniffer queue clean. |
| 2.11.6  | Implement quantity-based stacking/consolidation of similar items in Run Tracker, and show tracked item names and missions/sources on HUD overlay. |
| 2.11.7  | Parse mission titles for target items; filter out location/navigation objectives; sync active mission objectives robustly while preserving collected counts. |
| 2.11.8  | Fix blank white splash screen on startup; add parser for ATC "Hangar Request Completed" notification log. |
| 2.11.9  | Add customization options to untoggle cargo lift, oxygen, fire, corpse, death, vehicle, mission, crimestat alerts, and full screen flashes; fix font-loading rendering bug on splash screen. |
| 2.11.10 | Implement player respawn detection via RequestLocationInventory log events to automatically clear the HUD dead indicator. |
| 2.11.11 | Fix alert toggle checkboxes reverting on save (settings:save handler wasn't merging new flags); fix mass quantum arrival tray notification firing even when suppressed. |
| 2.11.12 | Parse `<CMissionLogEntry::UpdateActiveObjective>` log (SC 4.x engine format) to detect `[Text=...]` and emit MISSION_OBJECTIVE; this was the root cause of Run Tracker not auto-adding mission items. |
| 2.11.13 | Per-ship-name deduplication for quantum arrivals; tighten mass suppression threshold. |
| 2.11.14 | Parse `InventoryManagement` `Type[Move]` logs to track and show deposits/withdrawals via freight elevators and storage kiosks, updating the Run Tracker checklist on withdrawals. |
| 2.11.15 | Implement a 25-second cooldown on matching HUD warning voice announcements (TTS) to suppress repeat alerts triggered by terminal transactions or zone crossings. |
| 2.11.16 | Support quantum exits/arrivals and location restoration in overlay.html to prevent HUD from getting stuck in "IN QUANTUM" state on blind or manual jumps. |
| 2.11.17 | Add ITEM_TRANSFER rendering to overlay.html to display item deposits and withdrawals in the overlay Tactical Feed. |
| 2.11.18 | Suppress duplicate PLAYER_SPAWNED and ZONE notifications during terminal queries to prevent pushing item logs off the Tactical Feed; add broadcast-level warnings throttling. |
| 2.11.19 | Resolve dynamic quantum entry logs by tracking container swaps instead of relying on outdated hardcoded system container IDs. |
| 2.11.20 | Extract cargo hauling commodities directly from engine objective markers to bypass Star Citizen's tag compiler notification failure bug. |
| 2.11.21 | Add WebSocket broadcasting and tablet.html status dashboard support; enforce user-toggled alert suppressions globally across speech, overlays, and tray notifications. |
| 2.11.22 | Identify destination planet container on quantum exit to dynamically show the correct orbit location (e.g. microTech Orbit) until entering a sub-location. |
| 2.11.23 | Cache raw location codes globally upon detection and implement a Grab button fallback to current location if the sniffer queue is empty on start. |
| 2.11.24 | Implement separate configuration column in settings for HUD and Tablet alerts, allowing independent suppression of alerts on both outputs. |
| 2.11.25 | Add independent toggles for ship detections (Proximity Feed, Tactical Feed, Overlay HUD, Tablet); disable duplicate small banner warnings in overlay.html to prevent overlaps with the main fullscreen red alert window. |
| 2.11.26 | Completely disable the duplicate small alert box (showAlert) in overlay.html to resolve overlapping warnings under all scenarios. |
| 2.11.27 | Sync tablet filters from configuration, group multiple loading ships (>1 threshold), resolve duplicate ship entering alerts, style blueprint category options, and display user's customized location names in respawn alerts. |
| 2.11.28 | Implement KOS targets tab with a search/filter, a list of recently detected ships/IDs, and settings for auto-recording clips (hotkeys and triggers). |
| 2.11.29 | Implement unmapped location backlog caching in main.js to fix startup race condition (Jackson's Swamp now populates immediately); format live log stream with bold UK-formatted timestamps (en-GB locale) on the left. |

## 10. Unmapped Location Backlog Queue Startup Sync
- **The Issue**: During initial startup log scanning, `NEW_LOCATION` events (like Jackson's Swamp or other raw unmapped locations) fire before the dashboard window has loaded. Without caching, these events are lost, causing the unmapped location sniffer queue on the dashboard to start empty.
- **Backlog Cache**:
  - `main.js` maintains an in-memory `Set` called `unmappedLocationBacklog`.
  - When `NEW_LOCATION` is emitted, if the raw key is not already in `config.customLocations`, it is added to `unmappedLocationBacklog` (capped at 100 entries).
  - An IPC handler `settings:get-unmapped-backlog` is exposed to return the array of uncached unmapped location keys.
  - When a location is mapped (saved), it is deleted from the `unmappedLocationBacklog` set.
- **Dashboard Restoration**: On startup, `dashboard.html` invokes `settings:get-unmapped-backlog` and calls `addToBacklog(raw)` on each key to populate the sniffer list. Do NOT remove or bypass this IPC sync sequence.

## 11. Live Log Stream Bold UK Timestamps
- **Formatting**: Raw log lines displayed in the dashboard's "Live Log Stream" (#raw-log-list) must show the date and time on the left in bold, formatted in the UK locale (`en-GB` format: `DD/MM/YYYY, HH:mm:ss`).
- **Implementation**:
  - `addRawLogLine(line)` in `dashboard.html` parses the standard ISO/UTC timestamp from the beginning of the `Game.log` line using regex matching.
  - If a timestamp isn't present, it falls back to the current local system date and time.
  - It creates a bold span with `#ff9f0a` (amber/orange) styling containing `[DD/MM/YYYY, HH:mm:ss] ` prepended to the log text.
  - The raw line text remains fully copyable to the clipboard when clicked (so custom location parsing remains fully functional).

## 12. Non-Regression and Pattern Integrity Policy
- **No Feature Deletions**: Do not delete, disable, or speculative-bypass any modular parsers (such as `navigation.js`, `combat.js`, `vehicle.js`, etc.) or their corresponding HUD overlays.
- **Verification Requirement**: Whenever modifications are made to main.js, parsers, or dashboard/overlay layouts, the application must be packaged and tested using `npm run build:fast` to ensure syntactic and operational integrity.

## 13. Custom Pattern Manager Features & Dynamic Placeholders
- **Dynamic `{player}` Handle Replacement**:
  - Both starting and stop patterns support the `{player}` placeholder string.
  - The compiler in `custom.js` replaces `{player}` with the escaped RSI handle configuration (falling back to `TypicallyBrit_ish` if empty) to ensure custom patterns remain player-agnostic.
  - The regex tester inside `dashboard.html` likewise swaps `{player}` with the active user settings value before testing against example logs.
- **Dual Click-to-Ignore Regex Builders**:
  - The modal has visual tokenizers for both the primary pattern and the stateful stop pattern.
  - Segment lists (`pm-tokens-list`, `pm-stop-tokens-list`) dynamically parse lines, highlight literal matching elements, and allow selecting tokens to automatically translate them to ignoring regex rules (like numeric wildcards `\d+`, float wildcards `\d+\.\d+`, or general wildcards `.*?`).
- **Sub-HUD Text & Timers**:
  - Sub-HUD Text Labels are exposed globally and can be added to both stateful and non-stateful alerts.
  - Stateful alerts clear the Sub-HUD banner when their stop pattern matches.
  - Non-stateful alerts support a `subHudDuration` parameter. The engine in `custom.js` utilizes `setTimeout` to automatically clear/emit the removal state after the specified number of seconds. Active timeouts are cleared upon actor death, game disconnect/quit, or if the same custom alert triggers again.













