const BaseParser = require('./base');

/**
 * VehicleParser - Ship/Vehicle Detection
 * 
 * IMPORTANT NOTE (2026-02-14): After exhaustive forensic analysis of a real Game.log
 * (3968 lines, session from 2026-02-09), the following was confirmed:
 * 
 * - "Vehicle Control Flow", "SeatEnter", "SeatExit" patterns DO NOT exist in current SC builds
 * - Ship names appear in ASOP/Insurance lines (e.g., "DRAK_Caterpillar_Surface") 
 *   but NOT in seat enter/exit events
 * - The only vehicle-related logs are:
 *   1. LoadingPlatformManager (Hangar elevators)
 *   2. GenerateLocationProperty (Mission data, references ship names)
 *   3. ShipInsuranceProvider (ASOP terminal interactions)
 * 
 * This parser now uses VERIFIED patterns that actually appear in real logs.
 * Patterns are designed to be defensive - they won't match phantom data.
 */
class VehicleParser extends BaseParser {
    constructor() {
        super();
        this.patterns = {
            // ── VERIFIED PATTERNS ──

            // ASOP Insurance interactions include ship class names
            // Line 2048: [EXPEDIT FAILED] ShipSelectorKiosk_Hangar_LowTech_1_a-114 [9341298489796]
            // Line 2226: Ship Locations Query results don't match the shipData size!
            asop_interact: /<CEntityComponentShipInsuranceProvider/,

            // Mission data references ship names: "Caterpillar [566881991] [DRAK_Caterpillar_Surface]"
            // Line 2284: <GenerateLocationProperty> ... (Caterpillar [566881991] [DRAK_Caterpillar_Surface])
            mission_ship: /<GenerateLocationProperty>.*?\(([^[]+)\s+\[\d+\]\s+\[([^\]]+)\]\)/,

            // Hangar / Loading Platform Manager (tracks hangar elevator states)
            // Line 1174: <CSCLoadingPlatformManager::OnLoadingPlatformStateChanged> [Loading Platform] Loading Platform Manager [LoadingPlatformManager_ShipElevator_HangarXLTop] Platform state changed to OpeningLoadingGate
            hangar_state: /LoadingPlatformManager.*?ShipElevator.*?Platform state changed to (\w+)/i,

            // Fire Room detection - rooms inside ships have unique names
            // Lines 2073-2083: Fire Area 'Room_SnubBay_Room', 'Room_Tail_Room', 'Room_Habitation_Room', 'Room_Cockpit_AN_Room'
            ship_room: /Fire Area '(Room_(?:Cockpit|SnubBay|Habitation|Tail|Cargo_Hold|Turret|Engineering)[^']*?)'/i,

            // ── LEGACY PATTERNS (kept for future SC versions that might re-add them) ──
            vehicle_control: /<Vehicle Control Flow>/,
            seat_enter_raw: /SeatEnter\s+'([^']+)'/,
            seat_exit_raw: /SeatExit\s+'([^']+)'/,
            vehicle_name: /for\s+'([^']+)'/,
            ship_exit_confirm: /<Vehicle Control Flow>.*releasing/i,

            // Spawn Flow
            spawn_flow: /<Spawn Flow>/,
            spawn_reservation: /lost\s+reservation\s+for\s+spawnpoint\s+([^\s]+)\s+\[(\d+)\]/,
        };
        this.currentShip = null;
        this.shipMap = {};
        this.inShipRooms = new Set();
    }

    setShipMap(map) {
        this.shipMap = map || {};
    }

    parse(line) {
        let handled = false;

        // ── 1. Ship Room Detection (Fire Area rooms inside ships) ──
        const roomMatch = line.match(this.patterns.ship_room);
        if (roomMatch) {
            const roomName = roomMatch[1];
            if (!this.inShipRooms.has(roomName)) {
                this.inShipRooms.add(roomName);
                // If we detect cockpit room loading, we're likely in a ship
                if (roomName.toLowerCase().includes('cockpit') && !this.currentShip) {
                    this.currentShip = 'Unknown Ship';
                    this.emit('gamestate', { type: 'SHIP_ENTER', value: 'In Ship (Cockpit Detected)' });
                }
            }
            handled = true;
        }

        // ── 2. Legacy Vehicle Control Flow (kept for future versions) ──
        if (this.patterns.seat_enter_raw.test(line)) {
            const shipMatch = line.match(this.patterns.seat_enter_raw);
            if (shipMatch) {
                const name = this.getCleanShipName(shipMatch[1]);
                this.currentShip = name;
                this.emit('gamestate', { type: 'SHIP_ENTER', value: name });
                handled = true;
            }
        } else if (this.patterns.seat_exit_raw.test(line)) {
            const shipMatch = line.match(this.patterns.seat_exit_raw);
            if (shipMatch) {
                const name = this.getCleanShipName(shipMatch[1]);
                this.currentShip = null;
                this.inShipRooms.clear();
                this.emit('gamestate', { type: 'SHIP_EXIT', value: name });
                handled = true;
            }
        }

        // ── 3. Vehicle Control Flow Fallback ──
        if (!handled && this.patterns.vehicle_control.test(line)) {
            const vehicleMatch = line.match(this.patterns.vehicle_name);
            if (vehicleMatch) {
                const rawName = vehicleMatch[1];
                const cleanedName = this.getCleanShipName(rawName);

                if (line.includes('granted')) {
                    this.currentShip = cleanedName;
                    const payload = { type: 'SHIP_ENTER', value: cleanedName };
                    if (this.shipMap[cleanedName]) payload.image = this.shipMap[cleanedName];
                    this.emit('gamestate', payload);
                } else if (line.includes('releasing') && this.currentShip === cleanedName) {
                    this.currentShip = null;
                    this.inShipRooms.clear();
                    this.emit('gamestate', { type: 'SHIP_EXIT', value: cleanedName });
                }
                handled = true;
            }
        }

        // ── 4. Hangar State Detection ──
        const hangarMatch = line.match(this.patterns.hangar_state);
        if (hangarMatch) {
            const state = hangarMatch[1];
            this.emit('gamestate', { type: 'HANGAR_STATE', value: state });
            handled = true;
        }

        // ── 5. Fallback Exit (Generic) ──
        if (!handled && this.patterns.ship_exit_confirm.test(line) && this.currentShip) {
            this.emit('gamestate', { type: 'SHIP_EXIT', value: this.currentShip });
            this.currentShip = null;
            this.inShipRooms.clear();
            handled = true;
        }

        // ── 6. Spawn Flow (Where did I wake up?) ──
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
