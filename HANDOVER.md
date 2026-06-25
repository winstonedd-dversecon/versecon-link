# 🛰️ VerseCon Link & Tactical Link Handover Document

This file acts as the primary coordination node between AI developers. **Every AI instance taking over or working alongside this codebase MUST read this file first and update the "Sync Logs" section at the end of their turn.**

---

## 🔍 System Overview & Architecture Breakdown

VerseCon Link is an Electron desktop overlay application designed for Star Citizen players. It monitors gameplay in real-time and parses the local Star Citizen log file (`Game.log`).

### Core Architecture
1. **Entry Point & Electron Lifecycle**: [main.js](file:///c:/Users/DEVIL/Documents/projects/versecon-link/src/main/main.js)
   - Manages application windows, IPC (Inter-Process Communication) events, and coordinates system services.
2. **Log Watcher Engine**: [log-watcher.js](file:///c:/Users/DEVIL/Documents/projects/versecon-link/src/main/log-watcher.js)
   - Handles real-time polling/reading of the `Game.log` file.
   - Passes new log lines to registered parsers.
3. **Log Parsers**: Located in [parsers/](file:///c:/Users/DEVIL/Documents/projects/versecon-link/src/main/parsers/)
   - **Base Parser** ([base.js](file:///c:/Users/DEVIL/Documents/projects/versecon-link/src/main/parsers/base.js)): Base class for parser implementations.
   - **Combat Parser** ([combat.js](file:///c:/Users/DEVIL/Documents/projects/versecon-link/src/main/parsers/combat.js)): Tracks actor deaths. *Note: Regex pattern needs updating to match the `<Actor Death>` Star Citizen log structure.*
   - **Vehicle Parser** ([vehicle.js](file:///c:/Users/DEVIL/Documents/projects/versecon-link/src/main/parsers/vehicle.js)): Tracks vehicle state and destruction level changes.
   - **Zone Parser** ([zone.js](file:///c:/Users/DEVIL/Documents/projects/versecon-link/src/main/parsers/zone.js)): Tracks jurisdiction, monitored space, and armistice zones.
   - **Mission Parser** ([mission.js](file:///c:/Users/DEVIL/Documents/projects/versecon-link/src/main/parsers/mission.js)): Handles mission accepted/succeeded/failed states.
4. **API Client & Networking**: [api-client.js](file:///c:/Users/DEVIL/Documents/projects/versecon-link/src/main/api-client.js)
   - Interacts with remote databases/APIs (PostgreSQL adapter / API Server).

---

## 📂 Key Files to Read

Before doing any work, the new AI must read these documents:
1. **[START_HERE.md](file:///c:/Users/DEVIL/Documents/projects/versecon-link/START_HERE.md)**: High-level summary of deliverables and what needs to be fixed.
2. **[VERSECON_LINK_SETUP_PROMPT.md](file:///c:/Users/DEVIL/Documents/projects/versecon-link/VERSECON_LINK_SETUP_PROMPT.md)**: Detailed phase-by-phase setup, real log formats (Combat, Mission, Vehicle), and crew correlation specifications.
3. **[AUDIT_REPORT_2026-02-14.md](file:///c:/Users/DEVIL/Documents/projects/versecon-link/AUDIT_REPORT_2026-02-14.md)**: Details of which parsers are functional and which contain legacy/speculative bugs (e.g. removing mining, salvage, engineering).
4. **[main.js](file:///c:/Users/DEVIL/Documents/projects/versecon-link/src/main/main.js)**: To understand window management and API synchronization.

---

## 🚀 Standalone App Proposal: "Tactical Link"

The user wants to create a **new project** that extracts the core command and party-sync capabilities of VerseCon Link into a standalone, lightweight overlay application. 

### Core Features of "Tactical Link"
* **Squad Party List**: Real-time listing of party members showing current health, ship status, and location.
* **Shared Code Lobby**: A lightweight sync mechanism (e.g., using Socket.io or WebSockets) where entering a party code links players.
* **Tactical Command Overlay**: Session hosts (leaders) can issue overlay instructions/commands to party members in real-time.
* **Log-Driven States**: Utilizes the robust log parsing engine from VerseCon Link (e.g., `<Actor Death>` and `<Vehicle Destruction>`) to update squad statuses automatically.

This new project must be built in a separate directory so it does not touch or break the existing VerseCon Link app.

---

## 🔄 Sync Logs & Handover History

*This section must be appended to by every AI developer before concluding their session.*

### 📅 May 29, 2026 - Handover Created
* **Status**: Analysis of the current `versecon-link` directory complete. Found setup guides, audit reports, and main code folders.
* **Action**: Created [HANDOVER.md](file:///c:/Users/DEVIL/Documents/projects/versecon-link/HANDOVER.md) to serve as a shared sync file between active AI instances.
* **Next Steps for Next AI**:
  1. Use the prompt below to initialize the new **Tactical Link** project.
  2. Implement log-watcher extraction and websocket integration as outlined in the plan.

### 📅 June 16, 2026 - Capabilities Updated
* **Status**: Added and refined Quantum Travel Location/Arrival tracking, Proximity Death alerts (with local RSI handle normalized exclusion), and system WMI/Ping telemetry updates.
* **Action**: Documented capabilities in [CAPABILITIES.md](file:///c:/Users/DEVIL/Documents/projects/versecon-link/CAPABILITIES.md) for both the developer and public apps. Both setup installers have been successfully compiled and distributed.
