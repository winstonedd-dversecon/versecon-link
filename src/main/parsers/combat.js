const BaseParser = require('./base');

class CombatParser extends BaseParser {
    constructor() {
        super();
        this.patterns = {
            actor_death: /<Actor Death>/, // Generic
            // Picologs Advanced Logic:
            // <Actor Death> CActor::Kill: 'PlayerName' killed by 'KillerName' using 'WeaponName' (damage type: 'Type')
            // This regex is a guess based on Picologs description, we might need to refine it with real logs.
            // For now, we stick to robust generic detection and try to extract if possible.

            death_detailed: /<Actor Death>.*'([^']+)'\s+killed\s+by\s+'([^']+)'\s+using\s+'([^']+)'/i,

            destruction: /Distruction>/,
            vehicle_death: /VehicleDeath/,

            // Hazards
            suffocating: /Player.*started suffocating/i,
            depressurizing: /Player.*started depressurization/i,
            fire: /Fire detected/i,
        };
    }

    parse(line) {
        let handled = false;

        // 1. Actor Death
        if (this.patterns.actor_death.test(line)) {
            // Try detailed parse first
            const detail = line.match(this.patterns.death_detailed);
            if (detail) {
                const [_, victim, killer, weapon] = detail;
                this.emit('gamestate', {
                    type: 'DEATH',
                    value: 'Killed',
                    details: { victim, killer, weapon }
                });
            } else {
                // Fallback generic
                this.emit('gamestate', { type: 'STATUS', value: 'death' });
            }
            handled = true;
        }

        // 2. Hazards (Status Effects)
        if (this.patterns.suffocating.test(line)) {
            this.emit('gamestate', { type: 'STATUS', value: 'suffocating' });
            handled = true;
        }
        if (this.patterns.depressurizing.test(line)) {
            this.emit('gamestate', { type: 'STATUS', value: 'depressurizing' });
            handled = true;
        }
        if (this.patterns.fire.test(line)) {
            this.emit('gamestate', { type: 'HAZARD_FIRE', value: 'Fire Detected' });
            handled = true;
        }

        return handled;
    }
}

module.exports = new CombatParser();
