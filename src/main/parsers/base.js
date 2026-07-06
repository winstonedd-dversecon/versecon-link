const { EventEmitter } = require('events');

/**
 * Base Parser Class
 * All specific parsers (Navigation, Combat, etc.) should extend this.
 */
class BaseParser extends EventEmitter {
    constructor() {
        super();
        this.patterns = {};
    }

    /**
     * Process a single log line.
     * @param {string} line - The raw log line.
     * @param {object} context - Shared state/context if needed.
     * @returns {boolean} - True if the line was handled/matched, false otherwise.
     */
    parse(line, context = {}) {
        return false;
    }

    setCustomShipNames(map) {
        this.customShipNames = map || {};
    }

    /**
     * Helper to clean ship names (Standardized Logic)
     */
    getCleanShipName(rawName) {
        if (!rawName) return 'Ship';
        if (rawName === 'unknown') return 'Unknown';

        // Check custom mappings first
        if (this.customShipNames) {
            // Exact match
            if (this.customShipNames[rawName]) {
                return this.customShipNames[rawName];
            }
            // Fuzzy/prefix match
            for (const [key, value] of Object.entries(this.customShipNames)) {
                if (rawName.toLowerCase() === key.toLowerCase() || 
                    rawName.toLowerCase().startsWith(key.toLowerCase() + '_') ||
                    rawName.toLowerCase().includes('_' + key.toLowerCase() + '_') ||
                    rawName.toLowerCase().endsWith('_' + key.toLowerCase())) {
                    return value;
                }
            }
        }

        // 1. Remove company prefixes
        let name = rawName.replace(/^[A-Z]{3,4}_/, (match) => {
            const map = {
                'AEGS_': 'Aegis ', 'ANVL_': 'Anvil ', 'DRAK_': 'Drake ',
                'MISC_': 'MISC ', 'RSI_': 'RSI ', 'ORIG_': 'Origin ',
                'CRUS_': 'Crusader ', 'ARGO_': 'ARGO ', 'CNOU_': 'CO ',
                'BANU_': 'Banu ', 'AOPOA_': 'Aopoa ', 'ESPR_': 'Esperia ',
                'GATM_': 'Gatac ', 'MIRA_': 'Mirai ',
            };
            return map[match] || match.replace('_', ' ');
        });

        // 2. Remove suffixes & clean underscores
        return name.replace(/_\d+$/, '').replace(/_/g, ' ').trim();
    }
}

module.exports = BaseParser;
