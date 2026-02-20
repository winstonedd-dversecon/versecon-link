# VerseCon Link — Testing Checklist

Do each activity in Star Citizen, then copy your `Game.log` file and bring it back.
The log file is located at: `C:\Program Files\Roberts Space Industries\StarCitizen\LIVE\Game.log`

## ✅ Already Verified (Your Last Session)

These are confirmed working — no need to re-test unless something breaks:

- [x] Location tracking (STAMINA rooms, Loading Platforms)
- [x] Ship detection (VOIP channel join)
- [x] Fire on your ship (Snapshot Request + Similarity)
- [x] Suffocating / Depressurizing
- [x] Armistice zone enter/leave
- [x] Insurance claim (file + result)
- [x] Shop terminal interaction
- [x] ASOP terminal access
- [x] Mission engine create/stop
- [x] Server transfer start/end + world loaded
- [x] Voice channel create/connect/destroy
- [x] Nearby player detection
- [x] Inventory management events
- [x] System quit

---

## ❌ Needs Testing — Do These In-Game

### 1. 💀 Player Death

**What to do:** Get yourself killed (fall from height, drown, get shot by AI).
**What we're looking for:**

```
<Actor Death> CActor::Kill: 'YourName' ...
<[ActorState] Dead> ... Actor 'YourName' ... ejected from zone ...
```

**Expected HUD result:** Death alert with killer name and location.

---

### 2. 🚀 Ship Destruction

**What to do:** Let your ship get destroyed (fly into something, let AI shoot it).
**What we're looking for:**

```
<Vehicle Destruction> CVehicle::OnAdvanceDestroyLevel: Vehicle 'SHIP_NAME' ...
```

**Expected HUD result:** "Ship Destroyed" or "Ship Crippled" alert.

---

### 3. ⚡ Quantum Travel

**What to do:** Quantum jump to any destination (moon, station, etc.).
**What we're looking for:**

```
<Jump Drive Requesting State Change> ... to Traveling
<Jump Drive Requesting State Change> ... to Idle
<Quantum Drive Arrived>
```

**Expected HUD result:** "Quantum entered" / "Quantum exited" status.

---

### 4. 🚨 Interdiction

**What to do:** Get interdicted during quantum travel (happens randomly, or near comm arrays).
**What we're looking for:**

```
Interdiction
```

**Expected HUD result:** Interdiction alert.

---

### 5. ⚖️ CrimeStat

**What to do:** Commit a crime (attack someone, trespass in a restricted area).
**What we're looking for:**

```
CrimeStat Rating Increased
CrimeStat Rating Decreased
```

**Expected HUD result:** "CRIMESTAT INCREASED" warning.

---

### 6. 💸 UEC Fines

**What to do:** Get fined for something (parking violation, reckless flying near stations).
**What we're looking for:**

```
Fined 40000 UEC
```

**Expected HUD result:** "FINED [amount] UEC" warning.

---

### 7. 🏥 Medical Bed Respawn

**What to do:** Lie in a medical bed and set your respawn point.
**What we're looking for:**

```
DropoffLocation_BP[Destination], locations: (ClinicName [UUID])
```

**Expected HUD result:** "RESPAWN SET: [Clinic Name]" info.

---

### 8. 🛬 Landing Pad Assignment

**What to do:** Request a landing pad at a station (ATC / auto-land).
**What we're looking for:**

```
Added notification "Landing pad 04 assigned"
```

**Expected HUD result:** Landing pad number shown.

---

### 9. 🪑 Exit Pilot Seat (ClearDriver)

**What to do:** Stand up from the pilot seat while still inside your ship.
**What we're looking for:**

```
ClearDriver ... releasing control token for 'SHIP_NAME'
```

**Expected HUD result:** "Left Pilot Seat" notification.

---

### 10. 🌍 OCS Master Zone

**What to do:** Travel to a new area (fly to a planet surface, enter a station interior).
**What we're looking for:**

```
Master zone is [ZoneName]
```

**Expected HUD result:** Location hint update.

---

## 📋 How to Submit Your Logs

1. Play a session doing as many of the above as possible
2. **Copy** your `Game.log` to this project folder: `/home/damien/versecon-link/Game.log`
3. Tell the agent "I have new test logs" and it will run the audit automatically

## 💡 Bonus: Things to Try

- **Group up with a friend** — Does the log show party/group events?
- **Use a mining laser** — Does `<MiningLaser::SetLaserActive>` appear?
- **Use a salvage beam** — Does `<SalvageBeam::SetBeamActive>` appear?
- **Buy something from a shop** — Does `<ShopPurchase>` appear with item names?
- **Get into a dogfight** — What weapon fire / damage events show up?
