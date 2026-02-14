const BaseParser = require('./base');

/**
 * VehicleParser - Ship/Vehicle Detection (SC 4.6+)
 * 
 * VERIFIED PATTERNS (2026-02-14, from real Game.log with Esperia Prowler):
 * 
 * SHIP ENTER — VOIP Channel Join Notification
 *   Log: <SHUDEvent_OnNotification> Added notification "You have joined channel 'Esperia Prowler Utility : TypicallyBrit_ish'."
 *   Regex captures the full ship name before " : PlayerName"
 *   Works for ALL 200+ ships — the name between quotes is always "{ShipFullName} : {PlayerHandle}"
 * 
 * SHIP EXIT — Vehicle Control Flow ClearDriver
 *   Log: <Vehicle Control Flow> CVehicleMovementBase::ClearDriver: Local client node [...] releasing control token for 'ESPR_Prowler_Utility_9448279551878'
 *   Regex captures the internal ship code (e.g. ESPR_Prowler_Utility_9448279551878)
 *   getCleanShipName() strips the trailing numeric ID and converts underscores to spaces
 * 
 * NOTE: SC does NOT log a "SetDriver" or "granted" event — only ClearDriver (exit).
 *       There is no "You have left channel" VOIP event either.
 *       Fire Area "Room_*" patterns were removed — they false-positive near ASOP terminals.
 */
class VehicleParser extends BaseParser {
    constructor() {
        super();
        this.patterns = {
            // ── VERIFIED SC 4.6 PATTERNS ──

            // SHIP ENTER: VOIP channel join when boarding any ship
            // Captures: "Esperia Prowler Utility" from "You have joined channel 'Esperia Prowler Utility : PlayerName'."
            voip_join: /You have joined channel '(.+?)\s*:\s*[^']+'/,

            // SHIP EXIT: ClearDriver when leaving pilot seat
            // Captures: "ESPR_Prowler_Utility_9448279551878" from "releasing control token for 'ESPR_Prowler_Utility_9448279551878'"
            clear_driver: /ClearDriver.*releasing control token for '([^']+)'/,

            // Hangar / Loading Platform Manager (tracks hangar elevator states)
            hangar_state: /LoadingPlatformManager.*?ShipElevator.*?Platform state changed to (\w+)/i,

            // Spawn Flow
            spawn_flow: /<Spawn Flow>/,
            spawn_reservation: /lost\s+reservation\s+for\s+spawnpoint\s+([^\s]+)\s+\[(\d+)\]/,
        };
        this.currentShip = null;
        this.shipMap = {};
        this.lastEnterTime = 0;
    }

    setShipMap(map) {
        this.shipMap = map || {};
    }

    /**
     * Clean internal ship code into a readable name.
     * "ESPR_Prowler_Utility_9448279551878" → "ESPR Prowler Utility"
     * "ORIG_300i_Fighter_1234567890" → "ORIG 300i Fighter"
     * Strips trailing numeric ID (13+ digits = entity ID).
     */
    getCleanShipName(raw) {
        if (!raw) return 'Unknown';
        // Strip trailing entity ID (long number after last underscore)
        let cleaned = raw.replace(/_\d{10,}$/, '');
        // Convert underscores to spaces
        cleaned = cleaned.replace(/_/g, ' ').trim();
        return cleaned || raw;
    }

    parse(line) {
        let handled = false;
        const now = Date.now();

        // ── 1. SHIP ENTER: VOIP Channel Join ──
        // IMPORTANT: The VOIP join message appears on MULTIPLE log lines:
        //   - <SHUDEvent_OnNotification> Added notification "You have joined channel..."
        //   - "You have joined channel..." (continuation line)  
        //   - <UpdateNotificationItem> Notification "You have joined channel..."
        // We ONLY match on SHUDEvent to avoid duplicates.
        if (line.includes('SHUDEvent_OnNotification') && line.includes('joined channel')) {
            const voipMatch = line.match(this.patterns.voip_join);
            if (voipMatch) {
                const shipName = voipMatch[1].trim();

                // Dedup: ignore if same ship within 5 seconds
                if (shipName === this.currentShip && (now - this.lastEnterTime) < 5000) {
                    return true; // Absorbed, no duplicate
                }

                this.currentShip = shipName;
                this.lastEnterTime = now;
                const payload = { type: 'SHIP_ENTER', value: shipName };
                if (this.shipMap[shipName]) payload.image = this.shipMap[shipName];
                this.emit('gamestate', payload);
                handled = true;
            }
        }

        // ── 2. SHIP EXIT: ClearDriver (releasing control) ──
        // NOTE: ClearDriver fires when leaving the PILOT SEAT, not the ship.
        // Player may still be walking around inside. We emit a softer event
        // and only clear currentShip if no re-enter within a window.
        if (!handled) {
            const driverMatch = line.match(this.patterns.clear_driver);
            if (driverMatch) {
                const rawCode = driverMatch[1];
                const cleanName = this.getCleanShipName(rawCode);
                // Don't clear currentShip — user may still be aboard
                this.emit('gamestate', { type: 'SHIP_EXIT', value: cleanName, soft: true });
                handled = true;
            }
        }

        // ── 3. Hangar State Detection ──
        // NOTE: Removed — hangar.js handles this with proper state mapping
        // (TRANSIT/READY/CLOSED). Having two parsers emit HANGAR_STATE caused
        // the overlay to show raw states like "OpeningLoadingGate".

        // ── 4. Spawn Flow (Where did I wake up?) ──
        if (this.patterns.spawn_flow.test(line)) {
            const spawnMatch = line.match(this.patterns.spawn_reservation);
            if (spawnMatch) {
                const loc = spawnMatch[1].replace(/_/g, ' ');
                this.emit('gamestate', { type: 'SPAWN_SET', value: loc });
                handled = true;
            }
        }

        return handled;
    }
}

module.exports = new VehicleParser();
