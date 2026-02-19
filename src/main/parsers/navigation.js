const BaseParser = require('./base');

class NavigationParser extends BaseParser {
    constructor() {
        super();
        this.patterns = {
            // ── VERIFIED PATTERNS (proven against real Game.log) ──

            // Line 1935: <RequestLocationInventory> Player[TypicallyBrit_ish] requested inventory for Location[Stanton1_Lorville]
            location_inventory: /<RequestLocationInventory>\s+Player\[[^\]]+\]\s+requested inventory for Location\[([^\]]+)\]/i,

            // Line 1878: [STAMINA] \t-> RoomName: OOC_Stanton_1_Hurston
            // Matches OOC room names like OOC_Stanton_1_Hurston, OOC_Stanton_2b_Daymar
            stamina_room_ooc: /\[STAMINA\]\s+(?:\\t)?->\s*RoomName:\s*(OOC_[^\s]+)/i,

            // Generic RoomName for custom location mapping
            room_name: /RoomName:\s*([^\s]+)/i,

            // Line 711: <Join PU> address[34.150.199.123] port[64319] shard[pub_use1b_11173070_100] locationId[-281470681677823]
            join_pu: /<Join PU>\s+address\[([^\]]+)\]\s+port\[([^\]]+)\]\s+shard\[([^\]]+)\]/i,

            // Line 1906: <SHUDEvent_OnNotification> Added notification "Entered Hurston Dynamics Jurisdiction: "
            jurisdiction: /Added notification "Entered\s+(.*?)\s*Jurisdiction/i,

            // Line 1256: <SHUDEvent_OnNotification> Added notification "Entered Monitored Space: "
            monitored_space: /Added notification "Entered Monitored Space/i,

            // Line 1279: "Entering Armistice Zone - Combat Prohibited: "
            armistice_enter: /Added notification "Entering Armistice Zone/i,

            // Line 1282: "Leaving Armistice Zone - Caution Advised: "
            armistice_leave: /Added notification "Leaving Armistice Zone/i,

            // Generic Location[...] fallback (appears in many log lines)
            location_generic: /Location\[([^\]]+)\]/i,

            // ── LOCATION HINT (Object Container loading) ──
            // Lines like: data/objectcontainers/pu/loc/flagship/stanton/lorville/...
            location_obj: /<StatObjLoad\s+0x[0-9A-Fa-f]+\s+Format>\s+'[^']*?objectcontainers\/pu\/loc\/(?:flagship|mod)\/(?:stanton\/)?(?:station\/ser\/)?(?:[^\/]+\/)*([^\/]{5,})\//i,

            // ── QUANTUM TRAVEL (keep for future sessions where QT occurs) ──
            quantum_entered: /<Jump Drive Requesting State Change>.*to Traveling/,
            quantum_exited: /<Jump Drive Requesting State Change>.*to Idle/,
            quantum_arrived: /<Quantum Drive Arrived/,

            // Interdiction
            interdiction: /Interdiction/i,
        };
        this.lastLocationHint = null;
        this.lastLocation = null;
        this.customLocations = {};
    }

    setCustomLocations(map) {
        this.customLocations = map || {};
    }

    parse(line) {
        let handled = false;

        // ── 0. Custom Location Map (RoomName) ──
        const roomMatch = line.match(this.patterns.room_name);
        if (roomMatch) {
            const rawRoom = roomMatch[1];
            if (this.customLocations && this.customLocations[rawRoom]) {
                const customName = this.customLocations[rawRoom];
                this.emit('gamestate', { type: 'LOCATION', value: customName, raw: rawRoom });
                return true;
            }
            this.emit('gamestate', { type: 'LOCATION_RAW', value: rawRoom });
        }

        // ── 1. BEST: RequestLocationInventory (most reliable, exact location) ──
        const invMatch = line.match(this.patterns.location_inventory);
        if (invMatch) {
            const rawVal = invMatch[1];  // e.g. "Stanton1_Lorville"
            const cleaned = this.cleanLocationName(rawVal);
            if (cleaned !== this.lastLocation) {
                this.lastLocation = cleaned;
                this.emit('gamestate', { type: 'LOCATION', value: cleaned, raw: rawVal });
            }
            return true;
        }

        // ── 2. STAMINA OOC Room (good fallback for planetary position) ──
        const oocMatch = line.match(this.patterns.stamina_room_ooc);
        if (oocMatch) {
            const rawVal = oocMatch[1];  // e.g. "OOC_Stanton_1_Hurston"
            const cleaned = this.cleanOOCName(rawVal);
            if (cleaned && cleaned !== this.lastLocation) {
                this.lastLocation = cleaned;
                this.emit('gamestate', { type: 'LOCATION', value: cleaned, raw: rawVal });
            }
            return true;
        }

        // ── 3. Server Connection (Join PU) ──
        const puMatch = line.match(this.patterns.join_pu);
        if (puMatch) {
            this.emit('gamestate', {
                type: 'SERVER_CONNECTED',
                value: { address: puMatch[1], port: puMatch[2], shard: puMatch[3] }
            });
            return true;
        }

        // ── 4. Jurisdiction Notifications ──
        const jurisMatch = line.match(this.patterns.jurisdiction);
        if (jurisMatch) {
            const jurisdiction = jurisMatch[1].trim();
            this.emit('gamestate', { type: 'JURISDICTION', value: jurisdiction });
            handled = true;
        }

        if (this.patterns.armistice_enter.test(line)) {
            this.emit('gamestate', { type: 'ZONE', value: 'Armistice Zone' });
            handled = true;
        } else if (this.patterns.armistice_leave.test(line)) {
            this.emit('gamestate', { type: 'ZONE', value: 'Open Space' });
            handled = true;
        }

        // ── 5. Generic Location[...] fallback ──
        if (!handled) {
            const locMatch = line.match(this.patterns.location_generic);
            if (locMatch) {
                const rawVal = locMatch[1];
                // Filter out noise (numeric IDs, inventory refs, etc.)
                if (!rawVal.match(/^\d+$/) && !rawVal.includes(':') && rawVal.length > 3) {
                    const cleaned = this.cleanLocationName(rawVal);
                    const customVal = this.getCustomLocation(rawVal);
                    if (customVal) {
                        this.emit('gamestate', { type: 'LOCATION', value: customVal, raw: rawVal });
                        handled = true;
                    } else if (cleaned !== this.lastLocation) {
                        this.lastLocation = cleaned;
                        this.emit('gamestate', { type: 'LOCATION', value: cleaned, raw: rawVal });
                        handled = true;
                    }
                }
            }
        }

        // ── 6. Quantum State ──
        if (this.patterns.quantum_entered.test(line)) {
            this.emit('gamestate', { type: 'QUANTUM', value: 'entered' });
            handled = true;
        } else if (this.patterns.quantum_exited.test(line)) {
            this.emit('gamestate', { type: 'QUANTUM', value: 'exited' });
            handled = true;
        } else if (this.patterns.interdiction.test(line)) {
            this.emit('gamestate', { type: 'INTERDICTION', value: 'Quantum Jammed' });
            handled = true;
        } else if (this.patterns.quantum_arrived.test(line)) {
            this.emit('gamestate', { type: 'QUANTUM', value: 'arrived' });
            handled = true;
        }

        // ── 7. Object Container Hints (Backup Location) ──
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

    /**
     * Clean raw location names like "Stanton1_Lorville" -> "Lorville"
     */
    cleanLocationName(raw) {
        if (!raw) return '';

        // Known location name mappings
        const locationMap = {
            'Stanton1_Lorville': 'Lorville',
            'Stanton1_Hurston': 'Hurston',
            'Stanton2_Crusader': 'Crusader',
            'Stanton2_Orison': 'Orison',
            'Stanton3_ArcCorp': 'ArcCorp',
            'Stanton3_Area18': 'Area 18',
            'Stanton4_Microtech': 'Microtech',
            'Stanton4_NewBabbage': 'New Babbage',
            'Stanton_PortOlisar': 'Port Olisar',
            'Stanton_EverusHarbor': 'Everus Harbor',
            'Stanton_PortTressler': 'Port Tressler',
            'Stanton_BaijiniPoint': 'Baijini Point',
            'Stanton_SeraphimStation': 'Seraphim Station',
        };

        if (locationMap[raw]) return locationMap[raw];

        // Generic cleanup: remove Stanton prefix, replace underscores
        let cleaned = raw
            .replace(/^Stanton\d*_/, '')
            .replace(/_/g, ' ')
            .trim();

        return cleaned || raw;
    }

    /**
     * Clean OOC room names like "OOC_Stanton_1_Hurston" -> "Hurston"
     */
    cleanOOCName(raw) {
        if (!raw) return '';

        // Skip the top-level "OOC_Stanton" (too vague)
        if (raw === 'OOC_Stanton') return null;

        // OOC_Stanton_1_Hurston -> Hurston
        // OOC_Stanton_2b_Daymar -> Daymar
        // OOC_Stanton_3_ArcCorp -> ArcCorp
        const match = raw.match(/OOC_Stanton_\d+[a-z]?_(.+)/i);
        if (match) {
            return match[1].replace(/_/g, ' ');
        }

        // OOC_Stanton_1_Hurston without the underscore pattern
        const simpleMatch = raw.match(/OOC_Stanton_(\d+)_?(.+)/i);
        if (simpleMatch && simpleMatch[2]) {
            return simpleMatch[2].replace(/_/g, ' ');
        }

        return raw.replace(/^OOC_/, '').replace(/_/g, ' ');
    }

    /**
     * Normalize location keys for matching (handles +, _, and spaces)
     * Examples: "RR_P3_LEO", "RR+P3+LEO", "RR P3 LEO" all become "rrp3leo"
     */
    normalizeLocationKey(key) {
        if (!key) return '';
        return key
            .toLowerCase()
            .replace(/[+]/g, '')
            .replace(/[_]/g, '')
            .replace(/\s+/g, '')
            .trim();
    }

    /**
     * Find custom location by normalized key matching
     */
    getCustomLocation(rawVal) {
        if (!this.customLocations || !rawVal) return null;

        // First try exact match
        if (this.customLocations[rawVal]) {
            return this.customLocations[rawVal];
        }

        // Then try normalized match
        const normalized = this.normalizeLocationKey(rawVal);
        for (const [storedKey, friendlyName] of Object.entries(this.customLocations)) {
            if (this.normalizeLocationKey(storedKey) === normalized) {
                return friendlyName;
            }
        }

        return null;
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
            'hospital': 'Hospital', 'spaceport': 'Spaceport',
            'newbab': 'New Babbage', 'levski': 'Levski',
        };
        if (map[lower]) return map[lower];

        // Hangar Cleanup
        if (lower.includes('hangar')) {
            let name = lower.replace(/_/g, ' ');
            name = name.replace(/\blrgtop\b/i, '').replace(/\bsmltop\b/i, '')
                .replace(/\bmedtop\b/i, '').replace(/\bxltop\b/i, '')
                .replace(/\blext\b/i, '').replace(/\bxg\b/i, '')
                .replace(/\baeroview\b/i, '').replace(/\bselfland\b/i, '')
                .replace(/\bindustrial\b/i, '').replace(/\bvfg\b/i, '')
                .replace(/\brevelyork\b/i, '').replace(/\bhangar\b/i, '')
                .replace(/\b\d+\b/g, '').replace(/[()]/g, '')
                .replace(/\s+/g, ' ').trim();
            return name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        }

        // Generic cleaning
        let name = rawPath.replace(/_/g, ' ');
        name = name.replace(/ RS[A-Z0-9-]+$/i, '').replace(/^rs /i, '');
        return name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }
}

module.exports = new NavigationParser();
