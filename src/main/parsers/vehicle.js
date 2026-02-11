const BaseParser = require('./base');

class VehicleParser extends BaseParser {
    constructor() {
        super();
        this.patterns = {
            vehicle_control: /<Vehicle Control Flow>/,
            vehicle_name: /for\s+'([^']+)'/,
            seat_enter: /<Vehicle Seat Enter>/,
            seat_exit: /<Vehicle Seat Exit>/,
            spawn_flow: /<Spawn Flow>/,
            spawn_reservation: /lost\s+reservation\s+for\s+spawnpoint\s+([^\\s]+)\s+\[(\d+)\]/,
            ship_exit_confirm: /<Vehicle Control Flow>.*releasing/i
        };
        this.currentShip = null;
        this.shipMap = {};
    }

    setShipMap(map) {
        this.shipMap = map || {};
    }

    parse(line) {
        let handled = false;

        // 1. Vehicle Entry / Exit
        if (this.patterns.vehicle_control.test(line)) {
            const vehicleMatch = line.match(this.patterns.vehicle_name);
            if (vehicleMatch) {
                const rawName = vehicleMatch[1];
                const cleanedName = this.getCleanShipName(rawName);

                if (line.includes('granted')) {
                    this.currentShip = cleanedName;
                    const payload = { type: 'SHIP_ENTER', value: cleanedName };
                    if (this.shipMap[cleanedName]) payload.image = this.shipMap[cleanedName];
                    this.emit('gamestate', payload);
                } else if (line.includes('releasing')) {
                    this.currentShip = null; // We left the seat/ship
                    this.emit('gamestate', { type: 'SHIP_EXIT', value: cleanedName });
                }
                handled = true;
            }
        }

        // 2. Fallback Exit (Generic)
        if (!handled && this.patterns.ship_exit_confirm.test(line) && this.currentShip) {
            this.emit('gamestate', { type: 'SHIP_EXIT', value: this.currentShip });
            this.currentShip = null;
            handled = true;
        }

        // 3. Spawn Flow (Where did I wake up?)
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
