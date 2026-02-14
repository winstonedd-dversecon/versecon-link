# VerseCon Link - Quick Reference Cheat Sheet

## 🚀 QUICK START (Copy & Paste)

```bash
# Get running NOW
cd /home/damien/versecon-link
npm install
npm start
```

---

## 📄 YOUR THREE DOCUMENTS

| Document | Purpose | When to Read |
|----------|---------|--------------|
| **ROADMAP.md** | Executive summary, timeline, quick actions | Start here (5 min) |
| **VERSECON_LINK_SETUP_PROMPT.md** | Complete setup guide, phases 1-6 | During development |
| **BLEEDING_EDGE_RESEARCH.md** | Advanced features, research findings | For implementing tier 2-4 |

---

## ⚠️ CRITICAL ISSUES TO FIX FIRST

### Issue #1: Combat Parser is BROKEN
**File**: `src/main/parsers/combat.js`  
**Problem**: Regex pattern doesn't match real Star Citizen log format  
**Real Format**:
```
<Actor Death> CActor::Kill: 'victim' [id] in zone 'location' killed by 'killer' [id] 
using 'weapon' [Class X] with damage type 'type' from direction x: X, y: Y, z: Z
```
**Current Pattern**: Looking for `'PlayerName' killed by 'KillerName'` ❌  
**Fix**: Update regex in VERSECON_LINK_SETUP_PROMPT.md Phase 2

---

### Issue #2: App Isn't Running
**File**: Electron app not launched  
**Problem**: Never been started on this system  
**Fix**: `npm start` in terminal
**Verify**: Check if window opens and console shows parsing

---

### Issue #3: Mining/Salvage/Engineering are Fake
**Files**: `mining.js`, `salvage.js`, `engineering.js`  
**Problem**: Patterns are speculative, never verified in real logs  
**We Confirmed**: No evidence these events exist in Star Citizen logs  
**Fix**: Comment them out or move to `/disabled/` folder

---

### Issue #4: Phase 2 Features Don't Work
**Status**: Unverified, speculative patterns  
**Why**: Too ambitious without real log samples  
**What To Do**: Focus on Phase 1 first, add Phase 2 only after verified

---

## 🎯 PRIORITY FIXES (IN ORDER)

1. ⭐⭐⭐ **Fix Combat Parser** - 1-2 hours
2. ⭐⭐⭐ **Fix Mission Parser** - 1-2 hours  
3. ⭐⭐⭐ **Add Vehicle Destruction** - 2-3 hours
4. ⭐⭐ **Add Crew Correlation** - 1-2 hours
5. ⭐⭐ **Fix Armistice Zone Tracking** - 1-2 hours
6. ⭐⭐ **Add Comm Array/Monitored Space** - 2-3 hours
7. ⭐ **Add Test Suite** - 2-3 hours
8. 🚀 **Add Threat Assessment** (differentiator) - 3-4 hours
9. 🚀 **Add Danger Heatmap** (differentiator) - 3-4 hours
10. 🚀 **Add Movement Patterns** (differentiator) - 2-3 hours

---

## 📊 PARSER STATUS

| Parser | Status | Priority | Issue |
|--------|--------|----------|-------|
| **combat.js** | ❌ Broken | ⭐⭐⭐ | Wrong regex format |
| **mission.js** | ⚠️ Partial | ⭐⭐⭐ | Incomplete patterns |
| **vehicle.js** | ✅ Working | ⭐⭐ | VOIP join untested |
| **navigation.js** | ✅ Working | ✅ | No issues |
| **session.js** | ✅ Working | ✅ | No issues |
| **vehicle-destruction.js** | ❌ Missing | ⭐⭐⭐ | Needs creation |
| **crime.js** | ❌ Missing | ⭐ | Need to add |
| **jurisdiction.js** | ❌ Missing | ⭐ | Need to add |
| **mining.js** | ❌ Fake | ⭐⭐⭐ | Remove it |
| **salvage.js** | ❌ Fake | ⭐⭐⭐ | Remove it |
| **engineering.js** | ❌ Fake | ⭐⭐⭐ | Remove it |

---

## 🔍 WHAT ACTUALLY EXISTS IN STAR CITIZEN LOGS

✅ **Verified Logging:**
- Combat deaths (with full details)
- Vehicle destruction (multi-level)
- Mission completion/failure
- Location changes
- Quantum travel
- Player deaths with killer info
- Session/hardware info

❌ **NOT Logged (or unclear):**
- Mining laser state
- Salvage beam state  
- Engineering component state
- Real-time player position
- Cargo details
- Crew member roster

⚠️ **Needs Investigation:**
- Crime stat acquisition
- Bounty creation
- Communication array status
- Armor damage states
- Instance transitions

---

## 🐛 DEBUGGING QUICK FIXES

### Console Shows Nothing
```bash
# Check Game.log exists and updates
ls -lh /home/damien/.gemini/antigravity/game.log
tail -f /home/damien/.gemini/antigravity/game.log
# Should show new lines when playing Star Citizen
```

### Parser Not Matching
- Go to [regex101.com](https://regex101.com)
- Paste actual log line
- Test your regex pattern
- Verify it matches

### App Crashes Immediately
```bash
# Check for errors
npm start 2>&1 | tee debug.log
# Look at debug.log for error messages
```

### Can't Find Config
```bash
# Create config directory
mkdir -p ~/.config/VerseCon\ Link/
ls -la ~/.config/VerseCon\ Link/
```

---

## 📝 FILE STRUCTURE

```
/home/damien/versecon-link/
├── ROADMAP.md                          ← Quick reference (YOU ARE HERE)
├── VERSECON_LINK_SETUP_PROMPT.md       ← Setup guide
├── BLEEDING_EDGE_RESEARCH.md           ← Advanced features
├── src/
│   ├── main/
│   │   ├── main.js                     ← Entry point
│   │   ├── log-watcher.js              ← Core watcher
│   │   └── parsers/
│   │       ├── combat.js               ← ❌ BROKEN - FIX FIRST
│   │       ├── mission.js              ← ⚠️ Partial
│   │       ├── vehicle.js              ← ✅ Works
│   │       ├── navigation.js            ← ✅ Works
│   │       ├── session.js              ← ✅ Works
│   │       ├── mining.js               ← ❌ Remove
│   │       ├── salvage.js              ← ❌ Remove
│   │       └── engineering.js          ← ❌ Remove
│   └── renderer/
│       └── dashboard.html               ← UI
├── test/
│   └── parsers.test.js                 ← Tests (create)
├── package.json
└── README.md
```

---

## 💾 STAR CITIZEN LOG LOCATIONS

**Windows**: `C:\Games\StarCitizen\LIVE\Game.log`  
**Your Config**: `~/.gemini/antigravity/game.log` (symlink or backup)  
**Backups**: `StarCitizen/LIVE/logbackups/` (older logs)

**To Read Your Game.log:**
```bash
tail -f /home/damien/.gemini/antigravity/game.log
```

---

## 🎮 GAMEPLAY ACTIONS TO TEST PARSING

After fixing parsers, test these in-game:

- [ ] Change location → Should log location change
- [ ] Accept mission → Should log mission ID
- [ ] Complete mission → Should log mission_state
- [ ] Get in ship → Should log vehicle entry  
- [ ] Enter armistice zone → Should log armistice entry
- [ ] Exit armistice zone → Should log armistice exit
- [ ] Get killed (if possible) → Should log death event with killer/weapon
- [ ] Die to NPC → Should correlate NPC name correctly

---

## 🚨 WHAT NOT TO DO

❌ Don't track mining/salvage/engineering (doesn't exist)  
❌ Don't assume patterns without testing on real logs  
❌ Don't add features you can't verify in log files  
❌ Don't run app without Game.log being generated  
❌ Don't trust Phase 2 features without validation  
❌ Don't claim to track things that aren't in logs  

---

## ✅ WHAT TO DO

✅ Fix broken parsers first  
✅ Test against real Game.log  
✅ Add test suite for validation  
✅ Implement only verified features  
✅ Add predictive features after core works  
✅ Use BLEEDING_EDGE_RESEARCH.md for advanced features  

---

## 🎯 SHORT TERM GOALS (THIS WEEK)

- [ ] Get app running (`npm start`)
- [ ] Fix combat parser regex
- [ ] Fix mission parser
- [ ] Add vehicle destruction
- [ ] Test with real gameplay
- [ ] All tests passing

---

## 🚀 LONG TERM GOALS (NEXT 3 WEEKS)

- [ ] Crime/security tracking working
- [ ] Threat assessment engine built
- [ ] Danger heatmap visualization
- [ ] Movement pattern analysis active
- [ ] Unit tests 100% passing
- [ ] Web dashboard fully functional
- [ ] Competitive advantage evident

---

## 📞 IF STUCK

1. **Read**: VERSECON_LINK_SETUP_PROMPT.md debugging section
2. **Check**: Regex patterns at regex101.com with real log lines
3. **Verify**: Game.log exists and has recent content
4. **Enable**: Debug logging in code
5. **Search**: Error in console output

---

## 🎁 YOU NOW HAVE

✅ Complete setup guide (VERSECON_LINK_SETUP_PROMPT.md)  
✅ Bleeding-edge research document (BLEEDING_EDGE_RESEARCH.md)  
✅ Implementation roadmap (ROADMAP.md)  
✅ Quick reference sheet (THIS FILE)  
✅ Agent research on Star Citizen logging  
✅ Competitive analysis vs other tools  

---

## ▶️ RIGHT NOW DO THIS

```bash
# Copy this command and run it NOW
cd /home/damien/versecon-link && npm install && npm start

# Then in another terminal
tail -f /home/damien/.gemini/antigravity/game.log

# Then play Star Citizen and watch what gets logged
```

---

**NEXT STEP**: Read VERSECON_LINK_SETUP_PROMPT.md Phase 1-2  
**THEN**: Start fixing parsers based on real log format  
**GOAL**: Be THE BEST Star Citizen tracking tool  

**You've got this. Let's go. 🚀**
