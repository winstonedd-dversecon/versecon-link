# VerseCon Link - Complete Setup & Verification Guide

## PHASE 1: LAUNCH THE APPLICATION

### 1. Install Dependencies
```bash
cd /home/damien/versecon-link
npm install
```
- Verify all packages installed correctly
- Check node_modules exists with all dependencies

### 2. Configure Environment
```bash
mkdir -p ~/.config/VerseCon\ Link/
```
- Create config.json with game log path: `/home/damien/.gemini/antigravity/game.log`
- Create `~/.versecon-token` file (placeholder auth token)
- Set environment variables if needed (DB_HOST, DB_USER, DB_PASS)

### 3. Launch Electron App
```bash
npm start
# or
electron .
```
- Verify window opens and log watcher initializes
- Check that it's reading the game.log file
- Monitor console for parsing output

---

## PHASE 2: FIX PARSER PATTERNS BASED ON ACTUAL STAR CITIZEN LOGS

### Combat Parser (CRITICAL - WRONG FORMAT)

**Current Issue**: Looking for `'PlayerName' killed by 'KillerName'`

**Actual Star Citizen Log Format**:
```
<Actor Death> CActor::Kill: 'victim' [id] in zone 'location' killed by 'killer' [id] 
using 'weapon' [Class X] with damage type 'type' from direction x: X, y: Y, z: Z
```

**Fix Required**:
- Extract victim name and ID
- Extract killer name and ID  
- Extract weapon name and weapon class
- Extract damage type (Bullet, Combat, Collision, SelfDestruct, GameRules, VehicleDestruction)
- Extract direction vector (x, y, z coordinates)
- Extract location zone
- Distinguish FPS combat (Bullet damage) from vehicle combat

**Priority**: ⭐⭐⭐ CRITICAL

---

### Mission Parser (NEEDS VERIFICATION)

**Current Issue**: Looking for `MobiGlas::OnAcceptMission` and `Notification "Contract Accepted"`

**Actual Star Citizen Log Format**:
```
<MissionEnded> mission_id [UUID] - mission_state [STATE]
```

**States Tracked**: 
- `MISSION_STATE_ACCEPTED`
- `MISSION_STATE_SUCCEEDED`
- `MISSION_STATE_FAILED`
- `MISSION_STATE_CANCELLED`

**Additional Events**:
- `ObjectiveUpserted` - Mission ID, Objective ID, state (PENDING/INPROGRESS/COMPLETED)
- Text patterns: "New Objective:", "Objective Complete:", "Contract Accepted:"
- Marker creation: `Creating objective marker` with mission/objective IDs

**Fix Required**:
- Update to match actual MissionEnded format
- Extract UUID properly
- Parse state values correctly
- Add objective tracking via ObjectiveUpserted events
- Correlate mission start/accept/complete events

**Priority**: ⭐⭐⭐ CRITICAL

---

### Vehicle Destruction Parser (NOT IMPLEMENTED)

**Actual Star Citizen Log Format**:
```
<Vehicle Destruction> CVehicle::OnAdvanceDestroyLevel: Vehicle 'name' [id] 
in zone 'zone' driven by 'driver' [id] advanced from level N to M 
caused by 'attacker' [id] with 'damage_type'
```

**Destroy Levels**:
- 0 = Intact
- 1 = Crippled/Soft Death (salvageable)
- 2 = Fully Destroyed

**Data to Extract**:
- Vehicle name and full ID
- Driver name and ID
- Current and new destroy level
- Attacker name and ID
- Damage type
- Position coordinates (x, y, z)
- Velocity vector (x, y, z)

**Priority**: ⭐⭐⭐ CRITICAL

---

### Crew Correlation (NOT IMPLEMENTED)

**Feature**: Automatically link crew deaths to vehicle destructions

**Logic**:
- When vehicle is destroyed, find all Actor Death events within 200ms after
- Link those deaths to the vehicle destruction event
- Extract crew member information
- Track whether crew escaped or died with ship

**Why Important**: Distinguishes between solo vehicle loss vs multi-crew casualties

**Priority**: ⭐⭐ HIGH

---

### Armistice Zone Tracking (PARTIALLY WORKING)

**Current Issue**: Armistice zones not being tracked correctly

**Actual Star Citizen Log Patterns**:
```
Entered [ZONE_NAME] Jurisdiction
Left [ZONE_NAME] Jurisdiction
Armistice Zone: Entered
Armistice Zone: Left
```

**Zones to Track**:
- Space Ports: Crusader Spaceport, New Babbage, Area 18, Lorville, Port Olisar
- Rest Stops: Grim Hex, Caterpillar Rest Stop, etc.
- Stations in orbit
- Landing zones with turrets/security

**Data to Capture**:
- Zone entry timestamp
- Zone exit timestamp
- Zone security level
- Whether it's monitored space (turrets active)
- Player position change upon entry/exit
- NPC security presence

**Priority**: ⭐⭐ HIGH

---

### Monitored vs Non-Monitored Space (NEW FEATURE)

**Current Issue**: Not tracking whether space is monitored (comm arrays up) or not

**Actual Conditions**:
- **Monitored Space**: Comm arrays operational, security forces respond to crimes
- **Non-Monitored Space**: Comm arrays destroyed, NO security response, lawless
- **Status tracked by**: Scanning for security NPC presence, radar signatures, distress call response times

**Log Patterns to Detect**:
- Communication Array being destroyed: `<Event Destruction> [COMM_ARRAY_ID]`
- Jurisdiction notifications increase/decrease (more NPCs when monitored)
- Crime stat application speed (instant in monitored, delayed in non-monitored)
- Distress beacon response presence

**Data to Track**:
- Current monitoring status of sector
- Communication array status (up/down)
- Security NPC density in area
- Crime stat application state
- Recommended load-out for area (weapons needed?)

**Priority**: ⭐⭐ HIGH

---

### REMOVE These Features (SPECULATIVE, NOT IN LOGS)

- **mining.js** - No evidence mining events are logged in Star Citizen
- **salvage.js** - No evidence salvage events are logged in Star Citizen  
- **engineering.js** - No evidence engineering events are logged in Star Citizen

**Mark as**: Comment out completely or move to `/disabled/` directory
**Update**: TRACKED_LOGS.md to reflect Phase 2 NOT YET READY

**Priority**: ⭐⭐⭐ CRITICAL (Don't track things that don't exist)

---

## PHASE 3: ADD NEW ADVANCED TRACKING FEATURES

### A. Player Status & Effects Tracking

**Patterns to Implement**:
- Medical alerts: `[STAMINA]` tag indicating low stamina
- Life Support events: oxygen levels, pressure changes
- Quantum drive status: engaged/idle, quantum distance
- Health status: injured, bleeding, broken bones
- Status effect tags: suffocating, depressurizing, fire damage

**Data to Store**:
- Current health percentage
- Current stamina level
- Current oxygen level
- Active debuffs/effects
- Time in current location
- Time in current vehicle

**Priority**: ⭐⭐ HIGH

---

### B. Movement & Navigation Tracking

**Patterns to Implement**:
- **Quantum Jumps**: Track start, travel time, destination
- **Planetary Travel**: Atmospheric entry/exit detection
- **Landing Zone Entry**: Track which landing zone entered
- **Quantum Interrupted**: Track if QT was interrupted (combat, collision)
- **Position Deltas**: Calculate velocity from position changes at events

**Data to Store**:
- Current sector/region
- Origin location
- Destination location
- Travel time
- Whether travel was interrupted
- Estimated remaining travel time

**Priority**: ⭐⭐ HIGH

---

### C. NPC vs Player Detection Enhancement

**Current Gap**: Can't distinguish NPCs from players

**Patterns to Implement**:
- Explicit NPC name patterns: `PU_Pilot_`, `AI_`, `NPC_`, `Criminal-Pilot`, `Security-`, `Pirate-`
- Heuristic analysis: Names >40 chars, >3 hyphens = likely NPC
- Combat type detection: Weapon source (Bullet = FPS, engineered weapon = vehicle)
- Behavior pattern analysis: Known NPC names in database

**Data to Store**:
- Confidence level of player vs NPC classification
- Known player names in organization
- NPC pattern database
- Combat interaction type

**Priority**: ⭐ MEDIUM

---

### D. Economic Activity Tracking

**Patterns to Implement**:
- Trading events in logs
- Commodity buy/sell notifications
- Cargo loading/unloading at locations
- Insurance claims
- Repair/maintenance events

**Data to Store**:
- Commodity type and quantity
- Buy/sell price
- Total transaction value
- Location of trade
- Trading partner (if player-to-player)

**Priority**: ⭐ MEDIUM

---

### E. Ship Loadout & Equipment Tracking

**Patterns to Implement**:
- Weapon mounting: `Mounting 'weapon_name'`
- Shield generation: `Shield Generator Active`
- Power distribution: Track power allocation
- Cargo configuration changes
- Component damage/replacement

**Data to Store**:
- Current vehicle/ship
- Equipped weapons (type, count, mounting points)
- Shield generator type and status
- Cargo capacity used vs total
- Component health status

**Priority**: ⭐ MEDIUM

---

### F. Crime Stat & Legal Status Tracking

**Patterns to Implement**:
- Crime stat application: Track when crime stats added
- Bounty notifications: Track when bounties created
- Witness events: Track who reported crimes
- Jurisdiction-specific laws: Different laws in different regions
- Clearance events: Track crime stat removal

**Data to Store**:
- Current crime level (0-5 stars)
- Active bounties (source, amount)
- Witness count
- Hiding location effectiveness
- Time until clearance

**Priority**: ⭐ MEDIUM

---

### G. Social & Group Events

**Patterns to Implement**:
- Org member proximity detection
- Squad formation/dissolution
- Party invites and acceptances
- Voice chat channel joins (VOIP)
- Streaming status when applicable

**Data to Store**:
- Current party members
- Squad roles and composition
- Recent social interactions
- Who else is in same instance (if detectable)

**Priority**: ⭐ LOW

---

## PHASE 4: ADD COMPREHENSIVE TEST SUITE

### 1. Create Test Data Directory
```bash
mkdir -p /home/damien/versecon-link/test/fixtures
```

### 2. Collect Real Log Samples

For each event type, add real example log lines:
- Combat death event
- Mission acceptance
- Mission completion
- Vehicle destruction
- Location change
- Quantum jump
- Armistice zone entry/exit
- Crime stat application
- NPC interaction

### 3. Create Unit Tests

```bash
touch /home/damien/versecon-link/test/parsers.test.js
```

**Tests to Include**:
- Combat parser against real format
- Mission parser against real format
- Vehicle destruction parser
- Crew correlation logic
- Zone detection (armistice, monitored, non-monitored)
- Status effect detection
- Movement tracking
- NPC vs player classification

### 4. Setup Test Framework

```bash
npm install --save-dev jest
```

Create `jest.config.js` and add to `package.json`:
```json
"scripts": {
  "test": "jest"
}
```

### 5. Run Tests
```bash
npm test
```

Ensure all parsers pass validation against real log data.

---

## PHASE 5: SETUP DATA STORAGE & INTEGRATION

### Option A: Local JSON Storage (Already Configured)
- Events stored in `~/.config/VerseCon Link/events.json`
- No additional setup needed
- Good for single-user testing

### Option B: Connect to VerseCon Database (Recommended)

**Setup**:
1. Get database connection details from VerseCon team
2. Set environment variables:
   ```bash
   export DB_HOST=localhost
   export DB_PORT=5432
   export DB_NAME=versecon
   export DB_USER=versecon_user
   export DB_PASS=secure_password
   ```

3. Update event handlers to write to PostgreSQL
4. Sync with VCon API for profile matching

**Tables to Update**:
- `gameplay_events` - All parsed events
- `character_sessions` - Session data
- `character_stats` - Aggregated stats
- `location_history` - Navigation history
- `combat_log` - Combat events with crew correlation

---

## PHASE 6: REAL GAMEPLAY TESTING & VALIDATION

### Step 1: Prepare Test Session
```bash
npm start  # Launch VerseCon Link
# Keep console visible to watch parsing output
```

### Step 2: Play Star Citizen and Perform Actions

Perform each action and verify it's captured:

- [ ] **Accept a Mission**: Check mission_id and contract name captured
- [ ] **Complete a Mission**: Verify mission_state changes to SUCCEEDED
- [ ] **Travel to Different Location**: Verify location changes logged with zone names
- [ ] **Enter Armistice Zone**: Verify armistice zone entry detected
- [ ] **Exit Armistice Zone**: Verify armistice zone exit with dwell time
- [ ] **Enter Non-Monitored Space**: Verify comm array down status if applicable
- [ ] **Get in a Ship**: Verify vehicle entry and ship name/ID captured
- [ ] **Get Out of Ship**: Verify vehicle exit detected (or enable if not working)
- [ ] **Die in Combat** (if possible): Verify death event with killer, weapon, damage type
- [ ] **Destroy a Vehicle** (if possible): Verify destruction level tracking
- [ ] **Check Health/Stamina**: Verify status effects and health tracking

### Step 3: Validate Parsed Data

Check `~/.config/VerseCon Link/events.json` or database:

```javascript
// Should contain entries like:
{
  timestamp: "2026-02-14T12:34:56.789Z",
  event_type: "MISSION_ACCEPTED",
  mission_id: "UUID-HERE",
  mission_name: "Mission Title",
  contract_type: "Mercenary"
}

{
  timestamp: "2026-02-14T12:35:00.000Z",
  event_type: "LOCATION_CHANGED",
  system: "Stanton",
  planet: "Hurston",
  location_poi: "Lorville",
  armistice_zone: true,
  monitored_space: true
}

{
  timestamp: "2026-02-14T12:36:00.000Z",
  event_type: "COMBAT_DEATH",
  victim: "YourCharacter",
  killer: "NPC_Bandit_001",
  weapon: "Ballistic Rifle",
  weapon_class: "Medium",
  damage_type: "Bullet",
  location: "Stanton_Hurston_Lorville"
}
```

### Step 4: Check Accuracy

For each event:
- [ ] Timestamp is accurate (within 1 second)
- [ ] All required fields populated
- [ ] No spurious/duplicate events
- [ ] Location data matches where you actually were
- [ ] Names and IDs are correctly extracted

---

## PRIORITY IMPLEMENTATION ORDER

### 🔴 Must Fix First (Breaking Issues)
1. **Fix Combat Parser** - Currently broken with wrong regex
2. **Fix Mission Parser** - Patterns don't match actual format
3. **Launch the App** - It's not running on your system

### 🟠 Should Fix Next (Core Features)
4. **Add Vehicle Destruction Parser** - Critical missing feature
5. **Add Crew Correlation** - Needed to track multi-crew casualties
6. **Fix Armistice Zone Tracking** - Partially working, needs completion
7. **Add Monitored vs Non-Monitored Detection** - Critical for survival tracking

### 🟡 Should Add (Enhanced Features)
8. **Player Status & Effects** - Health, stamina, debuffs
9. **Movement & Navigation** - Quantum jumps, landing zones
10. **Add Test Suite** - Verify all changes work

### 🟢 Nice to Have (Polish)
11. **NPC Classification** - Better player vs NPC detection
12. **Economic Tracking** - Trading, cargo
13. **Crime Stat Tracking** - Legal status
14. **Social Events** - Party tracking

### 🔵 Remove (Stop Tracking Lies)
15. **REMOVE Phase 2** - Mining/Salvage/Engineering (not in logs)

---

## EXPECTED WORKING STATE (After Completion)

✅ App launches and stays running
✅ Reads Game.log in real-time (100ms polling)
✅ Parses location changes accurately (working)
✅ Parses mission acceptance/completion (FIXED)
✅ Parses combat deaths with full details (FIXED)
✅ Parses vehicle destruction with crew correlation (NEW)
✅ Tracks armistice zone entry/exit (FIXED)
✅ Detects monitored vs non-monitored space (NEW)
✅ Tracks player status effects (NEW)
✅ Stores events with accurate timestamps
✅ Connects to VerseCon API and shares data
✅ Passes all test cases
✅ Provides real intelligence about character activities
❌ Does NOT claim to track mining/salvage/engineering

---

## DEBUGGING CHECKLIST

If something isn't working:

### 1. Check Console Output
```bash
npm start
# Watch console for parsing output and errors
```

### 2. Check Game.log Exists and Updates
```bash
ls -lah /home/damien/.gemini/antigravity/game.log
tail -f /home/damien/.gemini/antigravity/game.log
# Should show new lines appearing as you play
```

### 3. Enable Debug Logging
In `src/main/log-watcher.js`, enable verbose logging:
```javascript
const DEBUG = true; // Set to true for detailed output
```

### 4. Test Regex Patterns
- Go to [regex101.com](https://regex101.com)
- Paste a real log line from your Game.log
- Test each parser's regex pattern against it
- Verify pattern matches

### 5. Check Config Files
```bash
cat ~/.config/VerseCon\ Link/config.json
cat ~/.versecon-token
# Should have valid paths and token
```

### 6. Verify PM2 Integration (If Using PM2)
```bash
pm2 status
pm2 log versecon-link
```

### 7. Database Connection (If Using)
```bash
psql -h $DB_HOST -U $DB_USER -d $DB_NAME
# Should connect successfully
```

---

## SUCCESS METRICS

- [ ] App runs for 1+ hour without crashing
- [ ] Every gameplay event is captured within 1 second
- [ ] No false positives in event detection
- [ ] All required data fields populated
- [ ] Test suite passes 100%
- [ ] Can load game history and see accurate timeline
- [ ] Integration with VerseCon shows up-to-date stats
- [ ] Can distinguish between your activities, NPCs, and other players' actions

---

## NEXT STEPS

1. **Run this command to start**:
   ```bash
   cd /home/damien/versecon-link && npm install && npm start
   ```

2. **Monitor the console output** to see what's being parsed

3. **Implement Phase 2 fixes** based on console errors

4. **Test with real gameplay** to validate everything works

5. **Iterate and improve** based on what you discover

---

**This document is your complete roadmap to getting VerseCon Link working perfectly.**
**Follow it phase by phase and you'll have the best Star Citizen activity tracker available.**
