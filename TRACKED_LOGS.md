# VerseCon Link - Tracked Log Patterns

This document lists the regex patterns used by the Log Engine to track game state.

> **LAST VERIFIED**: 2026-02-14 against real `Game (2).log` (Esperia Prowler session, 6448 lines)

## Phase 1: Core (VERIFIED ✅)

### Navigation (`navigation.js`)

- **Location (Primary)**: `<RequestLocationInventory> Player\[...\] requested inventory for Location\[([^\]]+)\]`
  - Example: `Location[RR_HUR_LEO]`
- **Location (OOC Fallback)**: `[STAMINA] RoomName: (OOC_Stanton_..._Name)`
  - Example: `OOC_Stanton_1_Hurston`
- **Server Connection**: `<Join PU> address\[([^\]]+)\] port\[([^\]]+)\] shard\[([^\]]+)\]`
  - Example: `address[34.11.90.244] port[64307] shard[pub_use1b_11218823_110]`
- **Monitored Space**: `Added notification "Entered Monitored Space: "`
- **Armistice Enter**: `Added notification "Entering Armistice Zone`
- **Armistice Leave**: `Added notification "Leaving Armistice Zone`
- **Jurisdiction**: `Added notification "Entered (.*?) Jurisdiction`
- **Quantum Jump**: `<Jump Drive Requesting State Change>.*to Traveling` ⚠️ Unverified
- **Quantum Exit**: `<Jump Drive Requesting State Change>.*to Idle` ⚠️ Unverified

### Vehicle (`vehicle.js`) - VERIFIED ✅

> [!IMPORTANT]
> SC 4.6 does NOT log `SetDriver`, `SeatEnter`, or `SeatExit`.

- **Ship Enter (VOIP Join)**: `You have joined channel '(.+?)\s*:\s*[^']+'`
  - Example: `You have joined channel 'Esperia Prowler Utility : TypicallyBrit_ish'`
  - Works for ALL 200+ ships — generic regex
- **Ship Exit (ClearDriver)**: `ClearDriver.*releasing control token for '([^']+)'`
  - Example: `releasing control token for 'ESPR_Prowler_Utility_9448279551878'`
  - `getCleanShipName()` strips trailing entity ID, converts underscores to spaces
- **Hangar State**: `LoadingPlatformManager.*?ShipElevator.*?Platform state changed to (\w+)`
  - Example: `Platform state changed to OpeningLoadingGate`

### Session (`session.js`) - VERIFIED ✅

- **Log Start**: `^<([^>]+)> Log started on`
- **Build Info**: `Built on (.+)`
- **Environment**: `Config: (.+)` (e.g., `shipping`)
- **Session ID**: `session=([a-f0-9]+)`

---

## Phase 2: Combat & Missions (RESEARCH 🔬)

> [!WARNING]
> These patterns are from community research (MASTER_GUIDE). They are implemented
> but have NOT been verified against a real combat/death log session yet.
> The first time you die in-game with VerseCon Link running, check if these fire!

### Combat (`combat.js`)

- **Actor Death (Detailed)**:

  ```
  <Actor Death>.*?'([^']+)'\s*\[\d+\].*?killed by\s+'([^']+)'\s*\[\d+\].*?using\s+'([^']+)'.*?damage type\s+'([^']+)'
  ```

  - Captures: victim, killer, weapon, damageType
  - Also extracts: zone (`in zone '...'`), direction vector (`from direction x: Y, z:`)
- **Actor Death (Fallback)**: `<Actor Death>` → emits generic `STATUS: death`
- **Vehicle Destruction (Detailed)**:

  ```
  <Vehicle Destruction>.*?Vehicle\s+'([^']+)'\s*\[\d+\].*?driven by\s+'([^']+)'\s*\[\d+\].*?from destroy level\s+(\d+)\s+to\s+(\d+).*?caused by\s+'([^']+)'
  ```

  - Captures: vehicle, driver, fromLevel, toLevel, attacker
  - Destroy levels: 0=intact, 1=crippled, 2=destroyed
  - Includes crew correlation (deaths within 500ms window)
- **Suffocation**: `Player.*started suffocating`
- **Depressurization**: `Player.*started depressurization`
- **Fire Hazard**: `<Fire.*Hazard>|Fire detected`

### Mission (`mission.js`)

- **Mission Ended (Structured)**: `<MissionEnded>\s*mission_id\s*\[([^\]]+)\]\s*-\s*mission_state\s*\[([^\]]+)\]`
  - Example: `<MissionEnded> mission_id [UUID] - mission_state [MISSION_STATE_SUCCEEDED]`
  - States: SUCCEEDED, FAILED, ABANDONED
- **Contract Accepted**: `Added notification "Contract Accepted:\s*([^"]+)"`
- **Contract Complete**: `Added notification "Contract Complete[d]?:\s*([^"]+)"`
- **Contract Failed**: `Added notification "Contract Failed:\s*([^"]+)"`
- **New Objective**: `Added notification "New Objective:\s*([^"]+)"`
- **Mission ID (metadata)**: `MissionId:\s*\[([^\]]+)\]` (ignores null UUIDs)

---

## Phase 3: Industrial (SPECULATIVE ❌)

> [!CAUTION]
> These patterns are 100% speculative — NEVER found in any real Star Citizen log.
> Mining, salvage, and engineering do not appear to log to Game.log.
> The parsers are still registered but will never match.

### Mining (`mining.js`) - NEVER VERIFIED

### Salvage (`salvage.js`) - NEVER VERIFIED

### Engineering (`engineering.js`) - NEVER VERIFIED

---

## Disabled Parsers

- **Zone** (`zone.js`): ❌ DISABLED in `index.js` — emits old-format values that conflict with `navigation.js`
