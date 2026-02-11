const BaseParser = require('./base');

class EngineeringParser extends BaseParser {
    constructor() {
        super();
        this.patterns = {
            power_state: /<PowerPlant::SetState>/,       // Speculative
            cooler_temp: /<Cooler::OnTemperatureChange>/, // Speculative
            fuse_break: /<Fuse::OnBreak>/                // Speculative
        };
    }

    parse(line) {
        let handled = false;

        // 1. Power Plant
        // Example: <PowerPlant::SetState> State[On] Output[100%]
        if (this.patterns.power_state.test(line)) {
            const stateMatch = line.match(/State\[([^\]]+)\]/);
            if (stateMatch) {
                this.emit('gamestate', {
                    type: 'ENGINEERING',
                    subtype: 'POWER',
                    state: stateMatch[1] // 'On', 'Off', 'Degraded'
                });
                handled = true;
            }
        }

        // 2. Fuse Break (Resource Network)
        // Example: <Fuse::OnBreak> Room[Engineering] ID[Fuse_01]
        if (this.patterns.fuse_break.test(line)) {
            const roomMatch = line.match(/Room\[([^\]]+)\]/);
            const idMatch = line.match(/ID\[([^\]]+)\]/);

            this.emit('gamestate', {
                type: 'ENGINEERING',
                subtype: 'FUSE_BREAK',
                room: roomMatch ? roomMatch[1] : 'Unknown',
                component: idMatch ? idMatch[1] : 'Unknown'
            });
            handled = true;
        }

        return handled;
    }
}

module.exports = new EngineeringParser();
