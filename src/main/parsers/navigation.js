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

            // Line 44819: <GenerateLocationProperty> Generated Locations - ... locations: (Hurston Cave [3018817963] [Cave_Unoccupied_Stanton1])
            generated_location: /<GenerateLocationProperty>.*?locations:\s*\(([^\[]+)\s*\[\d+\]\s*\[([^\]]+)\]\)/i,

            // ── LOCATION HINT (Object Container loading) ──
            // Lines like: data/objectcontainers/pu/loc/flagship/stanton/lorville/...
            location_obj: /<StatObjLoad\s+0x[0-9A-Fa-f]+\s+Format>\s+'[^']*?objectcontainers\/pu\/loc\/(?:flagship|mod)\/(?:stanton\/)?(?:station\/ser\/)?(?:[^\/]+\/)*([^\/]{5,})\//i,

            // ── QUANTUM TRAVEL (keep for future sessions where QT occurs) ──
            quantum_spooling: /Player Selected Quantum Target|Successfully calculated route to/i,
            quantum_entered: /<Jump Drive Requesting State Change>.*to Traveling/,
            quantum_exited: /<Jump Drive Requesting State Change>.*to Idle/,
            quantum_arrived: /<Quantum Drive Arrived/,

            // Interdiction
            interdiction: /Interdiction|Jammed|Interrupted|Forced Exit|Pulled out/i,

            // Freight Elevator (Outpost hints)
            // Can be: [LoadingPlatformManager_...] Platform state changed
            // Or: Platform manager 'LoadingPlatformManager_...'
            loading_platform: /(?:\[LoadingPlatformManager_([^\]]+)\]\s+Platform state changed|Platform manager 'LoadingPlatformManager_([^']+)')/i,

            // OCS (Object Container Selection) hints
            // Proximity sensor [Door] is creating a local helper... Master zone is [StreamingSOC_util_cmpd_wrhse_lge_001_rund_c...]
            ocs_master_zone: /Master zone is \[([^\]]+)\]/i,

            // Jump Point Grid Entrance
            // CPhysicalProxy::OnPhysicsPostStep is trying to set position in the grid (OOC_JumpPoint_stanton_magnus)
            jump_point: /position in the grid \((OOC_JumpPoint_[^)]+)\)/i,
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
            // Wait, roomName regex [^\s]+ won't match "RR P5 L2".
            // If the user's string has spaces, it might not be a RoomName.
            // But we can still emit LOCATION_RAW so smart capture sees it.
            this.emit('gamestate', { type: 'LOCATION_RAW', value: rawRoom });
        }

        // ── 1. BEST: RequestLocationInventory (most reliable, exact location) ──
        const invMatch = line.match(this.patterns.location_inventory);
        if (invMatch) {
            const rawVal = invMatch[1];  // e.g. "Stanton1_Lorville"
            const cleaned = this.cleanLocationName(rawVal);
            this.emitLocation(cleaned, rawVal);
            return true;
        }

        // ── 2. STAMINA OOC Room (good fallback for planetary position) ──
        const oocMatch = line.match(this.patterns.stamina_room_ooc);
        if (oocMatch) {
            const rawVal = oocMatch[1];  // e.g. "OOC_Stanton_1_Hurston"
            const cleaned = this.cleanOOCName(rawVal);
            if (cleaned) {
                this.emitLocation(cleaned, rawVal);
            }
            return true;
        }

        // ── 2.5 Jump Point Transit (High Priority) ──
        const jumpMatch = line.match(this.patterns.jump_point);
        if (jumpMatch) {
            const rawVal = jumpMatch[1]; // e.g. OOC_JumpPoint_stanton_magnus
            this.emitLocation('Wormhole Transit', rawVal);
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

        // ── 4.2 Generated Location Property (Mission Caves/Outposts) ──
        const genMatch = line.match(this.patterns.generated_location);
        if (genMatch) {
            const rawVal = genMatch[2];             // e.g., "Cave_Unoccupied_Stanton1"

            // Only emit NEW_LOCATION so the UI can log it for custom mapping.
            // Do NOT forcefully overwrite the current location because these drop continuously.
            this.emit('gamestate', { type: 'NEW_LOCATION', value: rawVal });
            return true;
        }

        // ── 4.5 Loading Platform (Outpost/Facility Hint) ──
        const platformMatch = line.match(this.patterns.loading_platform);
        if (platformMatch) {
            const rawVal = platformMatch[1] || platformMatch[2]; // fallback to group 2 if group 1 is undefined or empty

            // Filter out internal/generic SC 3.23+ elevators
            if (!rawVal.toLowerCase().includes('elevator') && !rawVal.toLowerCase().includes('kiosk')) {
                const cleanVal = rawVal.replace(/_/g, ' '); // FreightElevator HT Outpost -> FreightElevator HT Outpost
                // We emit this as a location hint to give user context they are at an outpost
                if (cleanVal && cleanVal !== this.lastLocationHint) {
                    this.lastLocationHint = cleanVal;
                    this.emit('gamestate', { type: 'LOCATION_HINT', value: cleanVal });
                }
            }
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
                    this.emitLocation(cleaned, rawVal);
                    handled = true;
                }
            }
        }

        // ── 6. Quantum State ──
        if (this.patterns.quantum_spooling.test(line) || this.patterns.quantum_entered.test(line)) {
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



        // ── 8. OCS Streaming Zones ──
        const ocsMatch = line.match(this.patterns.ocs_master_zone);
        if (ocsMatch) {
            // Usually looks like: StreamingSOC_util_cmpd_wrhse_lge_001_rund_c_final_int - Class(ObjectContainer)...
            const rawVal = ocsMatch[1];
            // Split out just the zone name before the hyphen
            const zoneName = rawVal.split(' - ')[0].trim();

            // Clean up the generic "StreamingSOC_" part if present
            let cleanVal = zoneName.replace(/^StreamingSOC_/, '').replace(/_/g, ' ').replace(/\b\d+\b/g, '').replace(/\b(?:int|ext|c|b|a|final|rund|cmpd|wrhse|lge|util)\b/ig, '').replace(/\s+/g, ' ').replace(/[\r\n]/g, '').trim();

            // Sometimes it's left completely empty after aggressive cleaning, fallback to slightly cleaner raw
            if (!cleanVal) cleanVal = zoneName.replace(/^StreamingSOC_/, '').replace(/_/g, ' ').replace(/[\r\n]/g, '').trim();

            // Only emit if it's new and somewhat readable (at least 3 chars)
            if (cleanVal.length > 3 && cleanVal !== this.lastLocationHint) {
                this.lastLocationHint = cleanVal;
                this.emit('gamestate', { type: 'LOCATION_HINT', value: cleanVal });
                handled = true;
            }
        }

        return handled;
    }

    emitLocation(cleanedName, rawName) {
        if (!cleanedName && !rawName) return;

        let finalName = cleanedName || rawName;
        let isCustomMapped = false;
        let matchedObj = null;

        if (this.customLocations) {
            // 1. Try exact match on raw
            if (this.customLocations[rawName]) {
                matchedObj = this.customLocations[rawName];
                isCustomMapped = true;
            }
            // 2. Try exact match on cleaned
            else if (this.customLocations[cleanedName]) {
                matchedObj = this.customLocations[cleanedName];
                isCustomMapped = true;
            }
            // 3. Try normalized match
            else {
                const normalizedRaw = rawName ? rawName.toLowerCase().replace(/[+_\s-]/g, '') : '';
                const normalizedCleaned = cleanedName ? cleanedName.toLowerCase().replace(/[+_\s-]/g, '') : '';

                for (const [key, val] of Object.entries(this.customLocations)) {
                    const normKey = key.toLowerCase().replace(/[+_\s-]/g, '');
                    if (normKey === normalizedRaw || (normalizedCleaned && normKey === normalizedCleaned)) {
                        matchedObj = val;
                        isCustomMapped = true;
                        break;
                    }
                }
            }

            if (matchedObj) {
                finalName = typeof matchedObj === 'object' ? matchedObj.name : matchedObj;
                const zone = typeof matchedObj === 'object' ? matchedObj.zone : 'Auto';
                const system = typeof matchedObj === 'object' ? matchedObj.system : 'Auto';

                if (system && system !== 'Auto') {
                    this.emit('gamestate', { type: 'SYSTEM', value: system });
                }

                if (zone && zone !== 'Auto') {
                    // Only emit zone override immediately if we are physically arriving at the location.
                    if (rawName !== this.currentLocationRaw) {
                        this.emit('gamestate', { type: 'ZONE', value: zone });
                    }
                }
            }
        }

        if (finalName !== this.lastLocation) {
            this.lastLocation = finalName;
            this.emit('gamestate', { type: 'LOCATION', value: finalName, raw: rawName });

            // Detect and emit systemic changes explicitly so UI can track what system the user is in
            const lowerRaw = rawName ? rawName.toLowerCase() : '';
            // Exclude jump point transits from system identification to prevent mid-jump misidentification
            if (!lowerRaw.includes('jumppoint')) {
                if (lowerRaw.includes('pyro') || lowerRaw.includes('pext') || lowerRaw.includes('pyro-') || lowerRaw.startsWith('p_')) {
                    this.emit('gamestate', { type: 'SYSTEM', value: 'Pyro' });
                } else if (lowerRaw.includes('nyx') || lowerRaw.includes('nyx-')) {
                    this.emit('gamestate', { type: 'SYSTEM', value: 'Nyx' });
                } else if (lowerRaw.includes('magnus') || lowerRaw.includes('magnus-')) {
                    this.emit('gamestate', { type: 'SYSTEM', value: 'Magnus' });
                } else if (lowerRaw.includes('stanton') ||
                    lowerRaw.includes('cru_') || lowerRaw.includes('hur_') || lowerRaw.includes('arc_') || lowerRaw.includes('mic_') ||
                    lowerRaw.includes('grimhex') || lowerRaw.includes('kareah') || lowerRaw.includes('portolisar') || lowerRaw.includes('seraphim') ||
                    lowerRaw.includes('everus') || lowerRaw.includes('baijini') || lowerRaw.includes('tressler') ||
                    lowerRaw.includes('orison') || lowerRaw.includes('lorville') || lowerRaw.includes('area18') || lowerRaw.includes('newbabbage') ||
                    lowerRaw.includes('stan-')
                ) {
                    this.emit('gamestate', { type: 'SYSTEM', value: 'Stanton' });
                }
            }

            // Check if this is a completely new/unmapped location
            if (!isCustomMapped && finalName === (cleanedName || rawName)) {
                // It's not custom mapped. Check if it's in the built-in clean map
                const builtInMap = this.getBuiltInLocationMap();
                if (!builtInMap[rawName]) {
                    // Not custom mapped and not a known built-in location -> Prompt user
                    this.emit('gamestate', { type: 'NEW_LOCATION', value: finalName, raw: rawName });
                }
            }
        }
    }

    getBuiltInLocationMap() {
        return {
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
    }

    /**
     * Clean raw location names like "Stanton1_Lorville" -> "Lorville"
     */
    cleanLocationName(raw) {
        if (!raw) return '';

        // Known location name mappings
        const locationMap = this.getBuiltInLocationMap();

        if (locationMap[raw]) return locationMap[raw];

        // Outpost, Bunker, Cave (e.g. Pyro4_Outpost_col_m_trdpst_indy_001)
        if (raw.toLowerCase().includes('_outpost_') || raw.toLowerCase().includes('_bunker_') || raw.toLowerCase().includes('_cave_')) {
            let type = '';
            let rawLower = raw.toLowerCase();
            if (rawLower.includes('_outpost_')) type = 'Outpost';
            else if (rawLower.includes('_bunker_')) type = 'Bunker';
            else if (rawLower.includes('_cave_')) type = 'Cave';

            let desc = '';
            if (rawLower.includes('_trdpst_')) desc = 'Trading Post ';
            else if (rawLower.includes('_scrp_')) desc = 'Scrap Yard ';
            else if (rawLower.includes('_sec_')) desc = 'Security ';
            else if (rawLower.includes('_dc_')) desc = 'Data Center ';
            else if (rawLower.includes('_shck_')) desc = 'Shack ';

            const parts = raw.split('_');
            const planet = parts[0].replace(/\d+$/, ''); // Pyro4 -> Pyro, Stanton1 -> Stanton

            return `${planet} ${desc}${type}`.trim();
        }

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

        // Common Stanton Planet Mappings (v2.10.12)
        const stantonMap = {
            '1': 'Hurston',
            '2': 'Crusader',
            '3': 'ArcCorp',
            '4': 'MicroTech'
        };

        // OOC_Stanton_1_Hurston -> Hurston
        // OOC_Stanton_2b_Daymar -> Daymar
        // OOC_Stanton_3_ArcCorp -> ArcCorp
        const match = raw.match(/OOC_Stanton_\d+[a-z]?_(.+)/i);
        if (match) {
            return match[1].replace(/_/g, ' ');
        }

        // OOC_Stanton_1_Hurston without the underscore pattern
        const simpleMatch = raw.match(/OOC_Stanton_(\d+)_?(.+)/i);
        if (simpleMatch) {
            if (simpleMatch[2]) return simpleMatch[2].replace(/_/g, ' ');
            if (stantonMap[simpleMatch[1]]) return stantonMap[simpleMatch[1]];
        }

        if (raw.toLowerCase().includes('jumppoint')) {
            return 'Wormhole Transit';
        }

        return raw.replace(/^OOC_/, '').replace(/_/g, ' ');
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
