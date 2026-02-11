const BaseParser = require('./base');

class NavigationParser extends BaseParser {
    constructor() {
        super();
        this.patterns = {
            location: /Location\[([^\]]+)\]/i,
            location_obj: /<StatObjLoad\s+0x[0-9A-Fa-f]+\s+Format>\s+'[^']*?objectcontainers\/pu\/loc\/(?:flagship|mod)\/(?:stanton\/)?(?:station\/ser\/)?(?:[^\/]+\/)*([^\/]{5,})\//i,
            quantum_entered: /<Jump Drive Requesting State Change>.*to Traveling/,
            quantum_exited: /<Jump Drive Requesting State Change>.*to Idle/,
            quantum_arrived: /<Quantum Drive Arrived/,

            // "Interdiction" might be a specific combat event, but fits nav flow
            interdiction: /Interdiction/i,
        };
        this.lastLocationHint = null;
    }

    parse(line) {
        let handled = false;

        // 1. Precise Location
        const locMatch = line.match(this.patterns.location);
        if (locMatch) {
            let val = locMatch[1];
            // Cleaning logic: OOC_Stanton_1b_Aberdeen -> Aberdeen
            val = val.replace(/^OOC_/, '')
                .replace(/Stanton_\d+[a-z]?_/, '')
                .replace(/_/g, ' ');

            this.emit('gamestate', { type: 'LOCATION', value: val });
            handled = true;
        }

        // 2. Quantum State
        if (this.patterns.quantum_entered.test(line)) {
            this.emit('gamestate', { type: 'QUANTUM', value: 'entered' });
            handled = true;
        } else if (this.patterns.quantum_exited.test(line)) {
            this.emit('gamestate', { type: 'QUANTUM', value: 'exited' });
            handled = true;
        } else if (this.patterns.quantum_arrived.test(line)) {
            this.emit('gamestate', { type: 'QUANTUM', value: 'arrived' });
            handled = true;
        }

        // 3. Object Container Hints (Backup Location)
        const objMatch = line.match(this.patterns.location_obj);
        if (objMatch) {
            const rawVal = objMatch[1];
            const cleanVal = this.cleanLocationHint(rawVal);
            if (cleanVal && cleanVal !== this.lastLocationHint) {
                this.lastLocationHint = cleanVal;
                this.emit('gamestate', { type: 'LOCATION_HINT', value: cleanVal });
                handled = true;
            }
        }

        return handled;
    }

    cleanLocationHint(rawPath) {
        if (!rawPath) return '';
        let lower = rawPath.toLowerCase();

        // Specific Mapping overrides
        const map = {
            'area18': 'Area 18', 'lorville': 'Lorville', 'new_babbage': 'New Babbage',
            'orison': 'Orison', 'seraphim_station': 'Seraphim Station',
            'port_tressler': 'Port Tressler', 'everus_harbor': 'Everus Harbor',
            'baijini_point': 'Baijini Point', 'astroarmada': 'Astro Armada',
            'dumper': 'Dumpers Depot', 'casaba': 'Casaba Outlet',
            'galleria': 'Galleria', 'admin_office': 'Admin Office',
            'centermass': 'Center Mass', 'platinumbay': 'Platinum Bay',
            'hospital': 'Hospital', 'spaceport': 'Spaceport'
        };
        if (map[lower]) return map[lower];

        // Hangar Cleanup (e.g., lorville_hangar_lrgtop -> Lorville)
        if (lower.includes('hangar')) {
            let name = lower.replace(/_/g, ' ');
            // Remove size descriptors and specific hangar types to just get the location
            name = name.replace(/\blrgtop\b/i, '')
                .replace(/\bsmltop\b/i, '')
                .replace(/\bmedtop\b/i, '')
                .replace(/\blext\b/i, '')
                .replace(/\bxg\b/i, '')
                .replace(/\baeroview\b/i, '')
                .replace(/\bselfland\b/i, '')
                .replace(/\bindustrial\b/i, '')
                .replace(/\bvfg\b/i, '')
                .replace(/\brevelyork\b/i, '')
                .replace(/\bhangar\b/i, '')
                .replace(/\b\d+\b/g, '') // Remove numbers (e.g. 001)
                .replace(/[()]/g, '') // Remove parentheses
                .replace(/\s+/g, ' ') // Clean double spaces
                .trim();

            // Capitalize
            return name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        }

        // Generic cleaning
        let name = rawPath.replace(/_/g, ' ');
        // Remove trailing RS info
        name = name.replace(/ RS[A-Z0-9-]+$/i, '').replace(/^rs /i, '');
        // Capitalize words
        return name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }
}

module.exports = new NavigationParser(); 
