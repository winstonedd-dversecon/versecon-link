# VerseCon Link — App Capabilities & Technical Specifications

This document outlines the capabilities, log parsing signatures, and telemetry features of the **Developer** (`versecon-link`) and **Public** (`versecon-link-public`) versions of the application.

---

## 🛰️ 1. Quantum Travel & Live Location Tracking

The application monitors real-time transit and arrival statuses to display live coordinates on the HUD:
* **Transit Location Shifts**: Captures when a player enters or exits quantum travel by parsing `<Update Inventory Location>` changes:
  * *Log Signature*: `<Update Inventory Location> Player [Handle] is changing location. Landing [X] -> [Y]. Location [A] -> [B]`
* **Quantum Arrival Detection**: Resolves quantum exit events to confirm exactly when a ship has reached its final stop:
  * *Log Signature*: `FinalStop=0 [Team_CGP4][QuantumTravel]`
  * *UI feedback*: Renders a high-impact HUD alert in neon-purple/violet (`#bf00ff`) with custom vignette-quantum edge shadows.
  * *Audio feedback*: Triggers a custom synthesized pitch-sweep sound (`alert_quantum`) and plays a voice announcement: `"Attention. [ShipName] arrived from quantum."`
* **Arrival Options & Customization**:
  * **Only Alert Quantum Exits**: An option to suppress standard radar scan detections (`RADAR_SINGLE` events) and only trigger visual/audio alerts for actual quantum exits (`TACTICAL_QUANTUM`).
  * **Suppress Mass Arrivals**: Automatically suppresses HUD alerts and TTS during rapid successive arrivals/detections (3+ events in 5 seconds) to prevent spam when first loading into a busy shard.
* **Planetary Filtering**: Automatically filters out `-1` values commonly logged for ships sitting static on planets.
* **Hangar Open Tracking**: Hangar door open/close time tracking has been disabled to prevent redundant UI pollution.

---

## ☠️ 2. Proximity Death Tracking

The application uses local entity load/registration events to dynamically alert you if a nearby player is killed:
* **Detection Trigger**: Detects bursts of 6 or more `<AttachmentReceived>` lines within a 6-second window, representing gear dropping/detaching from a deceased player:
  * *Log Signature*: `<AttachmentReceived> Player[Name] Attachment[...] Port[...]`
* **Local Player Exclusion**: Uses case-insensitive normalization (ignoring underscores, spaces, and dashes) to compare log entities against the user's configured `rsiHandle`. This ensures that when *you* swap weapons or gear, no false alarms are triggered.
* **Alert Mechanism**:
  * **Overlay UI**: Renders `☠ PROXIMITY KIA: [Player Name]` or `Proximity KIA: [Player Name]` directly on the overlay tactical feed.
  * **Tray Notification**: Sends a Windows tray balloon notification: `[Player Name] was eliminated nearby.`
  * **Text-to-Speech (TTS)**: Spoken voice alarm announces: `"Proximity target [Player Name] eliminated."`

---

## 🌐 3. System & Network Telemetry

Provides real-time system performance monitoring:
* **Bandwidth Monitoring**: Replaced inaccurate disk I/O-based metrics with native Windows WMI counters (`Win32_PerfFormattedData_Tcpip_NetworkInterface`) to calculate live download and upload network bandwidth.
* **AWS ICMP Ping workaround**: Since AWS game servers block standard ICMP pings, the ping module automatically routes a fallback test ping to Google DNS (`8.8.8.8`) to measure network latency.

---

## ⚙️ 4. Profiles & Configuration

* **Custom Handle Integration**: Users can input their own RSI Handle and RSI ID directly in the config UI to personalize their profile.
* **Local Player Normalization**: The app automatically strips formatting (e.g. comparing `TypicallyBrit_ish` and `TypicallyBritish` cleanly) to correctly link local actions without log discrepancies.

---

## 🔄 5. Version Differences

| Feature | Developer App (`versecon-link`) | Public App (`versecon-link-public`) |
| :--- | :--- | :--- |
| **Log Watching** | Game.log Real-time Engine | Game.log Real-time Engine |
| **Proximity KIA Alerts** | ✅ Yes | ✅ Yes |
| **Network & Latency Telemetry** | ✅ Yes (WMI + Fallback Ping) | ✅ Yes (WMI + Fallback Ping) |
| **User Handle Personalization**| ✅ Yes | ✅ Yes |
| **Developer Diagnostics & Tools**| ✅ Yes | ❌ No |
| **Extended API / DB Sync** | ✅ Yes | ❌ No (Clean companion mode) |
