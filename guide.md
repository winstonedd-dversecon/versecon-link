# VerseCon Link - Dev Build User Guide

Welcome to the **VerseCon Link Dev Build**! This guide details the features of the current development version, explaining how to run, configure, and make the most of the advanced telemetry tracking and HUD overlay tools.

---

## 🚀 Quick Start (Dev Mode)

To launch the dev build in Electron development mode:
```bash
npm install
npm start
```

To build a fast unpacked distribution directory for testing:
```bash
npm run build:fast
```

To compile the final NSIS installer executable (`dist/VerseCon Link Setup 2.11.0.exe`):
```bash
npm run dist
```

---

## 🛠️ Telemetry & HUD Overlay Features

### 1. Quantum Travel Status
- **Spooling**: Switching to Nav mode or spooling a route will show a `'spooling'` status in logs. The HUD will remain clean.
- **Traveling**: The HUD will transition to `'IN QUANTUM / TRANSIT'` **only** when your ship physically enters traveling state (when the jump drive state traveling line matches).

### 2. Mission Completed Recognition
- The app automatically detects completed contracts from both structured `SHUDEvent` notifications and `UpdateNotificationItem` comms logs.
- Completed and failed contracts are kept in the sidebar list with a green `COMPLETE` or red `FAILED` badge (instead of disappearing instantly) so you can verify success. You can click the `[X]` button next to them to dismiss them whenever you choose.
- Trailing colons are automatically stripped from contract titles.

### 3. Click-Through HUD Overlays
- By default, the main overlay, critical alerts, squad health monitor, and proximity network HUDs **ignore mouse events** and forward all clicks to the game behind.
- To arrange or resize the overlays, click **Unlock Overlays** in the dashboard. The windows will capture mouse events, allowing you to reposition them. Locking the overlays instantly restores click-through behavior.

### 4. Custom Location Mapping & Sniffer Suggestions
- **Sniffer Suggestions**: The Last Detected Raw Location sniffer box in the dashboard displays a clean **Suggested Name** for unmapped zones by stripping environment prefixes (e.g. `Outpost_PAF_`) and formatting to Title Case.
- **Auto-Fill friendly Name**: Clicking the **Grab** button automatically pre-fills the Friendly Name input with the suggested clean location name, letting you save mappings quickly.
- **Prefix & Typo Matching**: Custom location mapping uses robust prefix matching (e.g. Ruptura 1's pads and lobbies match the base custom location key) and normalized typo handling (e.g. automatically matching `asteriod` to `asteroid` for Wikelo Selo), suppressing duplicate unmapped location toast notifications.

### 5. Smart Weapon & Ammo Alerts
- When custom patterns match weapon equip events, the system ignores attachment logs matching port names starting with `magazine_` or `ammo_` or containing `_mag`, unless the custom pattern explicitly mentions ammo keywords (e.g., `mag`, `ammo`, `bullet`, `magazine`). This ensures you only get alerted when equipping the actual weapon.

### 6. Persistent Helmet Warning
- If you remove your helmet (deduplicated across active hands and attachment ports), a flashing amber `⚠️ NO HELMET` column instantly appears on the overlay HUD. It resets to hidden when you equip a helmet or respawn.
