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
