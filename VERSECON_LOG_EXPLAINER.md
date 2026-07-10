# VerseCon Link: App Architecture & Log Parsing Reference

This document serves as a comprehensive technical guide detailing what **VerseCon Link** does, how it watches Star Citizen logs, and the specific log patterns/structures it parses. It is designed to be ingested by other AI systems.

---

## 1. What the App Does

**VerseCon Link** is a real-time game telemetry, tracking, and HUD overlay engine for the MMO game **Star Citizen**.
* **Real-Time Telemetry**: It watches the game's active `Game.log` file, parsing new entries instantly to extract live game state.
* **HUD Overlay & Tablet Dashboard**: It feeds parsed events to an Electron-based HUD overlay (`overlay.html`) and broadcasts them via WebSockets to a local tablet dashboard (`tablet.html`).
* **Game State Tracking**: It monitors player health/death, vehicle occupancy, quantum travel, active mission objectives, cargo/freight transfers, locations, and economy transactions.
* **Run Tracker & Shopping Lists**: Tracks item collection tasks (e.g., missions, crafting components) by cross-referencing log events against a master item database.
* **Alert System**: Emits TTS (text-to-speech) announcements, audio alerts, and fullscreen warnings (e.g., threat detection, low helmet warning) based on log-level status updates.

---

## 2. How it Reads the Game Logs

* **Watcher Mechanism (`src/main/log-watcher.js`)**: Uses a Node.js file system watcher to track updates to `Game.log` (normally located under the Star Citizen installation path). It opens the file, tracks the byte size, and tails new line additions using standard streaming file APIs.
* **Log Noise Filtration**: To maintain high performance, the watcher filters out high-frequency engine logs (e.g. `CryAnimation`, `CryAction`, `CParticleEffect`, Vulkan/graphics warnings, physics debug traces) before passing lines to the parsers.
* **Modular Parsers (`src/main/parsers/`)**: Evaluates each new log line against a register of parser modules, running them through regex rules to extract metadata.

---

## 3. What it Reads from the Game Logs (Parser Specifications)

Here are the primary parser sub-modules and the specific Star Citizen engine log formats they extract.

### A. Navigation & Locations (`navigation.js`)
* **Player Location (Primary)**:
  * *Pattern*: `<RequestLocationInventory> Player[...] requested inventory for Location\[([^\]]+)\]`
  * *Example*: `Location[RR_HUR_LEO]`
* **Room / Stamina fallbacks**:
  * *Pattern*: `[STAMINA] RoomName: (OOC_Stanton_...)`
* **Friendly Name Extraction**:
  * *Pattern*: `<GenerateLocationProperty> Generated Locations - variablename: ... locations: (FriendlyName [numericId] [RawCode])`
  * *Behavior*: Extracts player-visible names (e.g. `Wikelo Emporium Kinga Station`) for raw location system codes and caches them.
* **Quantum Jumps**:
  * *Quantum Entry*: `<Jump Drive Requesting State Change>.*to Traveling`
  * *Quantum Exit*: `<Jump Drive Requesting State Change>.*to Idle`
  * *Quantum Arrived*: `<Quantum Drive Arrived`
* **Server Connection**:
  * *Pattern*: `<Join PU> address\[([^\]]+)\] port\[([^\]]+)\] shard\[([^\]]+)\]`

### B. Vehicle & Ship Boarding (`vehicle.js`)
* **Entering Ship (VOIP channel join fallback)**:
  * *Pattern*: `You have joined channel '(.+?)\s*:\s*[^']+'`
  * *Example*: `You have joined channel 'Esperity Prowler Utility : PlayerName'`
* **Exiting Ship**:
  * *Pattern*: `ClearDriver.*releasing control token for '([^']*)'`
  * *Example*: `releasing control token for 'ESPR_Prowler_Utility_9448279551878'` (cleans up name to "Esperia Prowler").

### C. Combat & Survival Alerts (`combat.js`)
* **Detailed Actor Death**:
  * *Pattern*: `<Actor Death>.*?'([^']+)'\s*\[\d+\].*?killed by\s+'([^']+)'\s*\[\d+\].*?using\s+'([^']+)'.*?damage type\s+'([^']+)'`
  * *Captures*: Victim, killer, weapon, damage type, zone (`in zone '...'`), and direction vector coordinates.
* **Helmet Detection**:
  * Tracks attachments to the `Armor_Helmet` actor port. If it is empty, emits `HELMET_STATE = 'OFF'`, triggering a warning overlay.
* **Hazards**: Detects suffocation (`Player.*started suffocating`), depressurization, and client fire area snapshot requests.

### D. Inventory & Run Tracker (`inventory.js`, `blueprint.js`)
* **Item Attachments**:
  * *Pattern*: `<AttachmentReceived> Player[...] Attachment[Name, Archetype, ID] Port[PortName]`
  * *Behavior*: Matches attachments to update Run Tracker collection counts. Bypasses custom alerts if port is `magazine_` or `ammo_`.
* **Freight & Storage transfers**:
  * *Pattern*: `<InventoryManagement> Request[...] for '[Name]' Result[Result]` (Specifically tracks type `Move` / withdrawals / deposits via elevator or storage kiosks).

### E. Missions & Active Objectives (`mission.js`)
* **Contract notifications**:
  * *Accepted*: `/(?:Added notification "Contract Accepted:\s*|Notification "Contract Accepted:\s*)([^"]+)"/`
  * *Completed*: `/(?:Added notification "Contract Complete[d]?:\s*|Notification "Contract Complete:\s*)([^"]+)"/`
  * *Failed*: `/(?:Added notification "Contract Failed:\s*|Notification "Contract Failed:\s*)([^"]+)"/`
  * *Note*: Trailing colons are trimmed automatically.
* **Active Objective Updates (Star Citizen 4.x Engine)**:
  * *Pattern*: Parses `<CMissionLogEntry::UpdateActiveObjective>` log updates to detect `[Text=...]` and extract immediate sub-objectives.

### F. Economy (`economy.js`)
* **Transactions**: Matches `<Transaction>`, `<ShopPurchase>`, and `<InsuranceClaim>` tags.
* **Fines**: Matches `Fined\s+(\d+)\s+UEC` to record player credit losses.
