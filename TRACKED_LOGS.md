# VerseCon Link - Tracked Log Patterns

This document lists the regex patterns used by the Log Engine to track game state.

> **LAST VERIFIED**: 2026-02-14 against real `Game.log` from session 2026-02-09 (3968 lines)

## Phase 1: Core

### Navigation (`navigation.js`) - VERIFIED ✅

- **Location (Primary)**: `<RequestLocationInventory> Player\[...\] requested inventory for Location\[([^\]]+)\]`
  - Example: `Location[Stanton1_Lorville]`
- **Location (OOC Fallback)**: `[STAMINA] RoomName: (OOC_Stanton_..._Name)`
  - Example: `OOC_Stanton_1_Hurston`
- **Server Connection**: `<Join PU> address\[([^\]]+)\] port\[([^\]]+)\] shard\[([^\]]+)\]`
  - Example: `address[34.150.199.123] port[64319] shard[pub_use1b_11173070_100]`
- **Jurisdiction Zone**: `Added notification "Entered (.*?) Jurisdiction`
- **Armistice Enter**: `Added notification "Entering Armistice Zone`
- **Armistice Leave**: `Added notification "Leaving Armistice Zone`
- **Quantum Jump**: `<Jump Drive Requesting State Change>.*to Traveling` (Unverified - kept for QT sessions)
- **Quantum Exit**: `<Jump Drive Requesting State Change>.*to Idle` (Unverified - kept for QT sessions)

### Vehicle (`vehicle.js`) - PARTIALLY VERIFIED

> [!WARNING]
> The following patterns from previous agents **DO NOT EXIST** in current SC builds (verified 2026-02-14):
>
> - `<Vehicle Control Flow>` — **NOT FOUND**
> - `SeatEnter '...'` — **NOT FOUND**
> - `SeatExit '...'` — **NOT FOUND**
> - `Notification "You have joined channel '...'"` — **NOT FOUND** (this is a party notification, not vehicle)

- **Ship Room (Verified)**: `Fire Area 'Room_(Cockpit|SnubBay|Habitation|Tail|Cargo_Hold)...'`
  - Example: `Fire Area 'Room_Cockpit_AN_Room'`
- **Hangar State (Verified)**: `LoadingPlatformManager.*?ShipElevator.*?Platform state changed to (\w+)`
  - Example: `LoadingPlatformManager_ShipElevator_HangarXLTop] Platform state changed to OpeningLoadingGate`

### Session (`session.js`) - VERIFIED ✅

- **Log Start**: `^<([^>]+)> Log started on`
- **Build Info**: `Built on (.+)`
- **Environment**: `Config: (.+)` (e.g., `shipping`)
- **Session ID**: `session=([a-f0-9]+)`

### Combat (`combat.js`) - UNVERIFIED

- **Death**: `<Actor Death>.*killed by \[(.*?)\]` (No deaths occurred in test session)

---

## Phase 2: Industrial (DRAFT - Needs Verification)

> [!WARNING]
> These patterns are speculative. None were found in the test `Game.log`.

### Mining (`mining.js`)

- **Laser Active**: `<MiningLaser::SetLaserActive>.*Active\[(\d)\]`
- **Fracture**: `<MiningFracture::OnFracture>.*Success\[(\d)\]`
- **Extraction**: `<MiningExtraction::OnExtraction>.*Amount\[([\d\.]+)\]`

### Salvage (`salvage.js`)

- **Beam Active**: `<SalvageBeam::SetBeamActive>.*Active\[(\d)\]`
- **Material Scrape**: `<SalvageMaterial::OnScrape>.*Amount\[([\d\.]+)\] Type\[(.*?)\]`

### Engineering (`engineering.js`)

- **Power State**: `<PowerPlant::SetState>.*State\[(.*?)\]`
- **Fuse Break**: `<Fuse::OnBreak>.*Room\[(.*?)\] ID\[(.*?)\]`
