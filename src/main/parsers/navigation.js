const BaseParser = require('./base');

class NavigationParser extends BaseParser {
    constructor() {
        super();
        this.patterns = {
            // ── VERIFIED PATTERNS (proven against real Game.log) ──

            // Line 1935: <RequestLocationInventory> Player[TypicallyBrit_ish] requested inventory for Location[Stanton1_Lorville]
            location_inventory: /<RequestLocationInventory>\s+Player\[[^\]]+\]\s+requested inventory for Location\[([^\]]+)\]/i,

            // Update Inventory Location tracking for quantum transitions
            inventory_location_change: /<Update Inventory Location>\s+Player\s+\[([^\]]+)\]\s+is\s+changing\s+location\.\s+Landing\s+\[[^\]]*\]\s+->\s+\[[^\]]*\].\s+Location\s+\[(\d+)\]\s+->\s+\[(\d+)\]/i,

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
            generated_location: /<GenerateLocationProperty>.*?locations:\s*((?:\([^)]+\))+)/i,

            // ── LOCATION HINT (Object Container loading) ──
            // Lines like: data/objectcontainers/pu/loc/flagship/stanton/lorville/...
            location_obj: /<StatObjLoad\s+0x[0-9A-Fa-f]+\s+Format>\s+'[^']*?objectcontainers\/pu\/loc\/(?:flagship|mod)\/(?:stanton\/)?(?:station\/ser\/)?(?:[^\/]+\/)*([^\/]{5,})\//i,

            // ── QUANTUM TRAVEL (keep for future sessions where QT occurs) ──
            quantum_spooling: /Successfully calculated route to/i,
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

            // CEntity::SetZone / SetLocalZone — reliable zone marker
            set_zone: /(?:SetZone|SetLocalZone).*?zone.*?'([^']{4,})'/i,

            // Region Volume Enter — large area markers
            region_volume: /entering region volume.*?'([A-Za-z][^']{3,})'/i,
            
            // Cargo/Freight Elevator updates
            cargo_elevator: /<CSCLoadingPlatformManager::OnLoadingPlatformStateChanged>.*?\[LoadingPlatformManager_([^\]]+)\] Platform state changed to (\w+)/i,

            // Stamina / Suffocation updates
            // Stamina / Suffocation updates
            stamina_suffocation: /<\[STAMINA\] Player (started|stopped) suffocating> Player\[([^\]]+)\]/i,

            // Quantum / Body Priority Patterns (v2.11.29)
            routeStartRegex: /Projected Start Location is (.*?) for route to destination ([^\s]+)/,
            routeSuccessRegex: /Successfully calculated route to ([^\s]+) fuel estimate ([\d.]+)/,
            quantumArrivedRegex: /Quantum Drive Arrived - Arrived at Final Destination/,
            planetCellsRegex: /planet cells:\s+(\d+)\s+\[\s*\d+\]\s+meshes:\s+(\d+)\s+\[\s*\d+\]\s+name:\s+(\S+)/,
            requestLocationRegex: /RequestLocationInventory.*Location\[(.*?)\]/,
            updateInventoryLocationRegex: /Update Inventory Location.*Location \[(\d+)\] -> \[(\d+)\]/
        };
        this.lastLocationHint = null;
        this.lastLocation = null;
        this.lastLocationRaw = null; // Track last raw for deduplication
        this.customLocations = {};
        this.rsiHandle = '';
        this.lastCargoElevatorId = null;
        this.lastCargoElevatorState = null;
        this.lastCargoElevatorTime = 0;

        // Priority Location state
        this.bodyMap = {
            pyro2: "Monox",
            RR_P2_L4: "Rough & Ready - Pyro 2 L4"
        };
        this.pendingQuantum = null;
        this.specificPoi = null;
        this.detectedBody = null;
        this.quantumDest = null;
        this.lastInventoryLoc = null;
        this.currentDisplayLocation = '';
        this.currentLocationSource = '';
    }

    setRsiHandle(handle) {
        this.rsiHandle = handle;
    }

    setCustomLocations(map) {
        this.customLocations = map || {};
    }

    setBodyMap(map) {
        this.bodyMap = map || {};
    }

    parse(line) {
        let handled = false;

        // ── 0.0 Quantum & Planet Cell Priority Detections ──
        const routeStartMatch = line.match(this.patterns.routeStartRegex);
        if (routeStartMatch) {
            const startLoc = routeStartMatch[1].trim();
            const destName = routeStartMatch[2].trim();
            this.pendingQuantum = {
                start: startLoc,
                destination: destName,
                timestamp: Date.now()
            };
            this.specificPoi = null; // Clear old POI on route calculate/selected
            this.updateLocationDisplay();
        }

        const routeSuccessMatch = line.match(this.patterns.routeSuccessRegex);
        if (routeSuccessMatch) {
            const destName = routeSuccessMatch[1].trim();
            if (this.pendingQuantum) {
                this.pendingQuantum.destination = destName;
            } else {
                this.pendingQuantum = {
                    destination: destName,
                    timestamp: Date.now()
                };
            }
            this.specificPoi = null;
            this.updateLocationDisplay();
        }

        if (this.patterns.quantumArrivedRegex.test(line)) {
            if (this.pendingQuantum) {
                this.quantumDest = this.pendingQuantum.destination;
            }
            this.specificPoi = null;
            this.updateLocationDisplay();
        }

        const planetMatch = line.match(this.patterns.planetCellsRegex);
        if (planetMatch) {
            const cells = parseInt(planetMatch[1], 10);
            const meshes = parseInt(planetMatch[2], 10);
            const name = planetMatch[3].trim();
            if (cells > 0 || meshes > 0) {
                this.detectedBody = name;
                this.updateLocationDisplay();
            }
        }

        const requestLocMatch = line.match(this.patterns.requestLocationRegex);
        if (requestLocMatch) {
            const rawVal = requestLocMatch[1];
            const cleaned = this.cleanLocationName(rawVal);
            this.specificPoi = cleaned;
            this.lastInventoryLoc = cleaned;
            this.updateLocationDisplay();
        }

        const updateInvMatch = line.match(this.patterns.updateInventoryLocationRegex);
        if (updateInvMatch) {
            const rawVal = updateInvMatch[2];
            const cleaned = this.cleanLocationName(rawVal);
            this.specificPoi = cleaned;
            this.lastInventoryLoc = cleaned;
            this.updateLocationDisplay();
        }

        // ── 0. Custom Location Map (RoomName) ──
        const roomMatch = line.match(this.patterns.room_name);
        if (roomMatch) {
            const rawRoom = roomMatch[1];
            // Only emit if value changed to prevent stuck/flood
            if (rawRoom && rawRoom !== this.lastLocationRaw) {
                this.lastLocationRaw = rawRoom;
                this.emit('gamestate', { type: 'LOCATION_RAW', value: rawRoom });

                // Also emit as a LOCATION update using the cleaned name
                const cleaned = this.cleanLocationName(rawRoom);
                this.emitLocation(cleaned, rawRoom);
            }
        }

        // ── 0.5 Inventory Location Change (Quantum Travel check) ──
        const invLocMatch = line.match(this.patterns.inventory_location_change);
        if (invLocMatch) {
            const player = invLocMatch[1];
            const fromLoc = invLocMatch[2];
            const toLoc = invLocMatch[3];

            // If an RSI handle is configured, verify it matches
            if (this.rsiHandle && player.toLowerCase() !== this.rsiHandle.toLowerCase()) {
                return false;
            }

            this.emit('gamestate', { type: 'QUANTUM', value: 'entered' });
            this.emitLocation('In Transit', 'QuantumTravel');
            return true;
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
            // Parse ALL (FriendlyName [numericId] [RawCode]) entries from the locations block
            const locationsBlock = genMatch[1];
            const entryPattern = /\(([^[]+?)\s*\[\d+\]\s*\[([^\]]+)\]\)/g;
            const nameMap = {};
            let entry;
            while ((entry = entryPattern.exec(locationsBlock)) !== null) {
                const friendlyName = entry[1].trim();
                const rawCode = entry[2].trim();
                if (rawCode && friendlyName) {
                    nameMap[rawCode] = friendlyName;
                    // Also normalise known typos in the raw code key
                    const normCode = rawCode.replace(/asteriod/gi, 'Asteroid');
                    if (normCode !== rawCode) nameMap[normCode] = friendlyName;
                }
            }

            // Emit the name hint map so the dashboard can suggest real names
            if (Object.keys(nameMap).length > 0) {
                this.emit('gamestate', { type: 'LOCATION_NAME_HINT', value: nameMap });
            }

            // Also emit each raw code as a NEW_LOCATION for the sniffer queue
            Object.keys(nameMap).forEach(rawCode => {
                this.emit('gamestate', { type: 'NEW_LOCATION', value: rawCode });
            });

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
        }
        // ── 4.6 Cargo Elevator Status ──
        const cargoMatch = line.match(this.patterns.cargo_elevator);
        if (cargoMatch) {
            const elevatorId = cargoMatch[1];
            const state = cargoMatch[2];
            const now = Date.now();

            if (elevatorId === this.lastCargoElevatorId && state === this.lastCargoElevatorState && (now - this.lastCargoElevatorTime) < 3000) {
                return true; // Suppress duplicate log events within 3s
            }

            this.lastCargoElevatorId = elevatorId;
            this.lastCargoElevatorState = state;
            this.lastCargoElevatorTime = now;

            this.emit('gamestate', {
                type: 'CARGO_ELEVATOR',
                value: { elevatorId, state }
            });
            handled = true;
        }

        // ── 4.7 Stamina / Suffocation Alerts ──
        const staminaMatch = line.match(this.patterns.stamina_suffocation);
        if (staminaMatch) {
            const status = staminaMatch[1]; // "started" or "stopped"
            const player = staminaMatch[2];
            this.emit('gamestate', {
                type: 'SUFFOCATION',
                value: { status, player }
            });
            handled = true;
        }

        // ── 5. Generic Location[...] fallback ──
        if (!handled) {
            const locMatch = line.match(this.patterns.location_generic);
            if (locMatch) {
                const rawVal = locMatch[1];
                // Filter out noise (numeric IDs, inventory refs, items like helmets/weapons/components, etc.)
                const isItemNoise = /_helmet|_armor|_weapon|_backpack|_suit|_mag|_ammo|_item|_device|_att|_attach|_component/i.test(rawVal) || 
                                    /^(?:rra|item|weapon|equip|component|armor|helmet)_/i.test(rawVal);
                if (!rawVal.match(/^\d+$/) && !rawVal.includes(':') && rawVal.length > 3 && !isItemNoise) {
                    const cleaned = this.cleanLocationName(rawVal);
                    this.emitLocation(cleaned, rawVal);
                    handled = true;
                }
            }
        }

        // ── 6. Quantum State ──
        if (this.patterns.quantum_entered.test(line)) {
            this.emit('gamestate', { type: 'QUANTUM', value: 'entered' });
            handled = true;
        } else if (this.patterns.quantum_spooling.test(line)) {
            this.emit('gamestate', { type: 'QUANTUM', value: 'spooling' });
            handled = true;
        } else if (this.patterns.quantum_exited.test(line)) {
            this.emit('gamestate', { type: 'QUANTUM', value: 'exited' });
            
            // Extract destination planet container (e.g., Stanton4) and set temporary orbit location
            const qExitMatch = line.match(/<Jump Drive Requesting State Change>\s+\(([^)]+)\)\s+from\s+Traveling\s+to\s+Idle/i);
            if (qExitMatch) {
                const containers = qExitMatch[1].split('->');
                if (containers.length >= 2) {
                    const dest = containers[1].trim();
                    let planetName = null;
                    if (dest.includes('Stanton1')) planetName = 'Hurston Orbit';
                    else if (dest.includes('Stanton2')) planetName = 'Crusader Orbit';
                    else if (dest.includes('Stanton3')) planetName = 'ArcCorp Orbit';
                    else if (dest.includes('Stanton4')) planetName = 'microTech Orbit';
                    else if (dest.includes('Pyro1')) planetName = 'Pyro I Orbit';
                    else if (dest.includes('Pyro2')) planetName = 'Pyro II Orbit';
                    else if (dest.includes('Pyro3')) planetName = 'Pyro III Orbit';
                    else if (dest.includes('Pyro4')) planetName = 'Pyro IV Orbit';
                    else if (dest.includes('Pyro5')) planetName = 'Pyro V Orbit';
                    else if (dest.includes('Pyro6')) planetName = 'Pyro VI Orbit';
                    
                    if (planetName) {
                        this.emitLocation(planetName, dest);
                    }
                }
            }
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

        // ── 9. SetZone / Region Volume (fallback raw location) ──
        const setZoneMatch = line.match(this.patterns.set_zone);
        if (setZoneMatch) {
            const rawVal = setZoneMatch[1];
            if (rawVal && rawVal !== this.lastLocationRaw && !rawVal.match(/^\d+$/) && rawVal.length > 3) {
                this.lastLocationRaw = rawVal;
                this.emit('gamestate', { type: 'LOCATION_RAW', value: rawVal });

                // Also emit as a LOCATION update using the cleaned name
                const cleaned = this.cleanLocationName(rawVal);
                this.emitLocation(cleaned, rawVal);
            }
        }

        const regionMatch = line.match(this.patterns.region_volume);
        if (regionMatch) {
            const rawVal = regionMatch[1];
            const cleaned = this.cleanLocationName(rawVal);
            if (cleaned && cleaned !== this.lastLocation) {
                this.emitLocation(cleaned, rawVal);
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
            // 3. Try prefix / startsWith / normalized match with typo handling (asteriod -> asteroid)
            else {
                const normalizedRaw = rawName ? rawName.toLowerCase().replace(/[+_\s-]/g, '').replace('asteriod', 'asteroid') : '';
                const normalizedCleaned = cleanedName ? cleanedName.toLowerCase().replace(/[+_\s-]/g, '').replace('asteriod', 'asteroid') : '';

                let bestKey = null;
                let bestVal = null;
                let bestLen = 0;

                for (const [key, val] of Object.entries(this.customLocations)) {
                    const normKey = key.toLowerCase().replace(/[+_\s-]/g, '').replace('asteriod', 'asteroid');
                    
                    if (normalizedRaw === normKey || normalizedCleaned === normKey || 
                        (normalizedRaw.startsWith(normKey) && normKey.length > 5) || 
                        (normalizedCleaned.startsWith(normKey) && normKey.length > 5)) {
                        
                        if (normKey.length > bestLen) {
                            bestLen = normKey.length;
                            bestKey = key;
                            bestVal = val;
                        }
                    }
                }

                if (bestKey) {
                    matchedObj = bestVal;
                    isCustomMapped = true;
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
            const details = this.getPlanetAndSystem(rawName, finalName, matchedObj);
            if (details.system) {
                this.emit('gamestate', { type: 'SYSTEM', value: details.system });
            }
            if (details.planet) {
                this.emit('gamestate', { type: 'PLANET', value: details.planet });
            }
            this.specificPoi = finalName;
            this.lastInventoryLoc = finalName;
            this.updateLocationDisplay();

            // Detect and emit systemic changes explicitly so UI can track what system the user is in
            const lowerRaw = rawName ? rawName.toLowerCase() : '';
            // Exclude jump point transits from system identification to prevent mid-jump misidentification
            if (!lowerRaw.includes('jumppoint')) {
                if (lowerRaw.includes('jp_')) {
                    if (lowerRaw.includes('jp_pyro')) {
                        this.emit('gamestate', { type: 'SYSTEM', value: 'Pyro' });
                    } else if (lowerRaw.includes('jp_nyx')) {
                        this.emit('gamestate', { type: 'SYSTEM', value: 'Nyx' });
                    } else if (lowerRaw.includes('jp_stanton')) {
                        this.emit('gamestate', { type: 'SYSTEM', value: 'Stanton' });
                    } else if (lowerRaw.includes('jp_magnus')) {
                        this.emit('gamestate', { type: 'SYSTEM', value: 'Magnus' });
                    }
                } else {
                    if (lowerRaw.includes('pyro') || lowerRaw.includes('pext') || lowerRaw.includes('p_') || /_p\d_/.test(lowerRaw) || /p\d[a-z]?l\d/.test(lowerRaw)) {
                        this.emit('gamestate', { type: 'SYSTEM', value: 'Pyro' });
                    } else if (lowerRaw.includes('nyx')) {
                        this.emit('gamestate', { type: 'SYSTEM', value: 'Nyx' });
                    } else if (lowerRaw.includes('magnus')) {
                        this.emit('gamestate', { type: 'SYSTEM', value: 'Magnus' });
                    } else if (lowerRaw.includes('stanton') ||
                        lowerRaw.includes('cru_') || lowerRaw.includes('hur_') || lowerRaw.includes('arc_') || lowerRaw.includes('mic_') ||
                        lowerRaw.includes('grimhex') || lowerRaw.includes('kareah') || lowerRaw.includes('portolisar') || lowerRaw.includes('seraphim') ||
                        lowerRaw.includes('everus') || lowerRaw.includes('baijini') || lowerRaw.includes('tressler') ||
                        lowerRaw.includes('orison') || lowerRaw.includes('lorville') || lowerRaw.includes('area18') || lowerRaw.includes('newbabbage') ||
                        lowerRaw.includes('stan-') || lowerRaw.includes('dist_')
                    ) {
                        this.emit('gamestate', { type: 'SYSTEM', value: 'Stanton' });
                    }
                }
            }

            // Check if this is a completely new/unmapped location
            if (!isCustomMapped && finalName === (cleanedName || rawName)) {
                const lowerRaw = rawName ? rawName.toLowerCase() : '';
                const lowerClean = finalName ? finalName.toLowerCase() : '';
                
                const isSystemNoise = lowerRaw.includes('quantum') || lowerRaw.includes('transit') || 
                                     lowerRaw.includes('jumppoint') || lowerRaw.includes('inventory') ||
                                     lowerRaw.includes('weapon') || lowerRaw.includes('helmet') || 
                                     lowerRaw.includes('armor') || lowerRaw.includes('magazine') || 
                                     lowerRaw.includes('ammo') || lowerRaw.includes('undock') ||
                                     lowerRaw.includes('test') || lowerRaw.includes('loading') ||
                                     lowerRaw.includes('_mag') || lowerRaw.includes('helmethook') ||
                                     lowerClean.includes('quantum') || lowerClean.includes('transit');

                if (!isSystemNoise) {
                    // It's not custom mapped. Check if it's in the built-in clean map
                    const builtInMap = this.getBuiltInLocationMap();
                    if (!builtInMap[rawName]) {
                        // Not custom mapped and not a known built-in location -> Prompt user
                        this.emit('gamestate', { type: 'NEW_LOCATION', value: finalName, raw: rawName });
                    }
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
            'Stanton_SeraphimStation': 'Seraphim Station',
            'Stanton_EverusHarbor': 'Everus Harbor',
            'Stanton_PortTressler': 'Port Tressler',
            'Stanton_BaijiniPoint': 'Baijini Point',
            'Stanton_SeraphimStation': 'Seraphim Station',
            // Distribution Centers (3.23)
            'Stanton1_DC_Greycat_A': 'Covalex Hub G-A',
            'Stanton1_DC_Hurston_B': 'Hurston DC-B',
            'Stanton3_DC_ArcCorp_C': 'ArcCorp DC-C',
            'Stanton4_DC_MicroTech_D': 'MicroTech DC-D',
            // Pyro (4.0)
            'Pyro1_Bloom': 'Bloom',
            'Pyro2_Monolith': 'The Monolith',
            'Pyro3_Checkpoint': 'Checkpoint',
            'Pyro6_Starlight_Service': 'Starlight Service',
            'Pyro_RuinStation': 'Ruin Station',
            'RR_P2_L4': 'Checkmate',
            // Jump Points
            'RR_JP_PyroNyx': 'Pyro Gateway',
            'RR_JP_NyxPyro': 'Nyx Gateway',
            'RR_JP_StantonPyro': 'Stanton Gateway',
            'RR_JP_PyroStanton': 'Pyro Gateway'
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

    getPlanetAndSystem(rawName, cleanName, customLocObj) {
        let planet = 'Unknown';
        let system = 'Unknown';

        // 1. If it's in customLocations and has system/planet set
        if (customLocObj && typeof customLocObj === 'object') {
            if (customLocObj.system && customLocObj.system !== 'Auto') system = customLocObj.system;
            if (customLocObj.planet && customLocObj.planet !== 'Auto') planet = customLocObj.planet;
        }

        const rawLower = (rawName || '').toLowerCase();
        const cleanLower = (cleanName || '').toLowerCase();

        // 2. Resolve System if still unknown
        if (system === 'Unknown') {
            if (rawLower.includes('stanton') || rawLower.includes('cru_') || rawLower.includes('hur_') || rawLower.includes('arc_') || rawLower.includes('mic_') ||
                rawLower.includes('grimhex') || rawLower.includes('kareah') || rawLower.includes('seraphim') || rawLower.includes('everus') || 
                rawLower.includes('baijini') || rawLower.includes('tressler') || rawLower.includes('orison') || rawLower.includes('lorville') || 
                rawLower.includes('area18') || rawLower.includes('newbabbage') || rawLower.includes('stan-') || rawLower.includes('dist_') ||
                cleanLower.includes('stanton') || cleanLower.includes('orison') || cleanLower.includes('lorville') || cleanLower.includes('babbage')) {
                system = 'Stanton';
            } else if (rawLower.includes('pyro') || rawLower.includes('pext') || rawLower.includes('p_') || /_p\d_/.test(rawLower) || /p\d[a-z]?l\d/.test(rawLower) || cleanLower.includes('pyro')) {
                system = 'Pyro';
            } else if (rawLower.includes('nyx') || cleanLower.includes('nyx')) {
                system = 'Nyx';
            } else if (rawLower.includes('magnus') || cleanLower.includes('magnus')) {
                system = 'Magnus';
            } else if (rawLower.includes('terra') || cleanLower.includes('terra')) {
                system = 'Terra';
            }
        }

        // 3. Resolve Planet/Moon if still unknown
        if (planet === 'Unknown') {
            // Check Stanton bodies
            if (rawLower.includes('hurston') || rawLower.includes('stanton1') || rawLower.includes('hur_') || rawLower.includes('lorville') || rawLower.includes('everus') || cleanLower.includes('hurston') || cleanLower.includes('lorville')) {
                planet = 'Hurston';
            } else if (rawLower.includes('crusader') || rawLower.includes('stanton2') || rawLower.includes('cru_') || rawLower.includes('orison') || rawLower.includes('seraphim') || cleanLower.includes('crusader') || cleanLower.includes('orison')) {
                planet = 'Crusader';
            } else if (rawLower.includes('arccorp') || rawLower.includes('stanton3') || rawLower.includes('arc_') || rawLower.includes('area18') || rawLower.includes('baijini') || cleanLower.includes('arccorp') || cleanLower.includes('area 18')) {
                planet = 'ArcCorp';
            } else if (rawLower.includes('microtech') || rawLower.includes('stanton4') || rawLower.includes('mic_') || rawLower.includes('newbabbage') || rawLower.includes('tressler') || cleanLower.includes('microtech') || cleanLower.includes('babbage')) {
                planet = 'microTech';
            }
            // Check moons
            else if (rawLower.includes('ariel') || cleanLower.includes('ariel')) planet = 'Ariel';
            else if (rawLower.includes('aberdeen') || rawLower.includes('abernathy') || cleanLower.includes('aberdeen')) planet = 'Aberdeen';
            else if (rawLower.includes('ita') || cleanLower.includes('ita')) planet = 'Ita';
            else if (rawLower.includes('magda') || cleanLower.includes('magda')) planet = 'Magda';
            else if (rawLower.includes('cellin') || cleanLower.includes('cellin')) planet = 'Cellin';
            else if (rawLower.includes('daymar') || cleanLower.includes('daymar')) planet = 'Daymar';
            else if (rawLower.includes('yela') || cleanLower.includes('yela') || rawLower.includes('grimhex') || cleanLower.includes('hex')) planet = 'Yela';
            else if (rawLower.includes('lyria') || cleanLower.includes('lyria')) planet = 'Lyria';
            else if (rawLower.includes('wala') || cleanLower.includes('wala')) planet = 'Wala';
            else if (rawLower.includes('calliope') || cleanLower.includes('calliope')) planet = 'Calliope';
            else if (rawLower.includes('clio') || cleanLower.includes('clio')) planet = 'Clio';
            else if (rawLower.includes('euterpe') || cleanLower.includes('euterpe')) planet = 'Euterpe';
            // Check Pyro bodies
            else if (rawLower.includes('pyro1') || rawLower.includes('pyro 1') || cleanLower.includes('pyro i')) planet = 'Pyro I';
            else if (rawLower.includes('pyro2') || rawLower.includes('pyro 2') || cleanLower.includes('pyro ii') || rawLower.includes('monastery')) planet = 'Pyro II';
            else if (rawLower.includes('pyro3') || rawLower.includes('pyro 3') || cleanLower.includes('pyro iii')) planet = 'Pyro III';
            else if (rawLower.includes('pyro4') || rawLower.includes('pyro 4') || cleanLower.includes('pyro iv')) planet = 'Pyro IV';
            else if (rawLower.includes('pyro5') || rawLower.includes('pyro 5') || cleanLower.includes('pyro v')) planet = 'Pyro V';
            else if (rawLower.includes('pyro6') || rawLower.includes('pyro 6') || cleanLower.includes('pyro vi')) planet = 'Pyro VI';
        }

        return { planet, system };
    }

    updateLocationDisplay() {
        let chosenLocation = '';
        let chosenSource = '';

        if (this.specificPoi) {
            chosenLocation = this.specificPoi;
            chosenSource = 'inventory/location update';
        } else if (this.detectedBody) {
            const mappedName = this.bodyMap[this.detectedBody] || `Unknown body (${this.detectedBody})`;
            chosenLocation = `${mappedName} orbit`;
            chosenSource = 'planet cell streaming';
        } else if (this.quantumDest) {
            const mappedName = this.bodyMap[this.quantumDest] || `Unknown body (${this.quantumDest})`;
            chosenLocation = `${mappedName} orbit`;
            chosenSource = 'quantum destination';
        } else if (this.lastInventoryLoc) {
            chosenLocation = this.lastInventoryLoc;
            chosenSource = 'last known inventory location';
        } else {
            chosenLocation = 'Unknown Location';
            chosenSource = 'fallback';
        }

        if (chosenLocation !== this.currentDisplayLocation) {
            this.currentDisplayLocation = chosenLocation;
            this.currentLocationSource = chosenSource;
            this.lastLocation = chosenLocation;

            let planetName = 'Unknown';
            let systemName = 'Unknown';
            let finalValue = chosenLocation;

            if (chosenLocation.toLowerCase().endsWith(' orbit')) {
                const body = chosenLocation.slice(0, -6).trim();
                planetName = body;
                finalValue = 'Orbit';

                const rawBody = this.detectedBody || this.quantumDest || '';
                const lowerRaw = rawBody.toLowerCase();
                const lowerBody = body.toLowerCase();

                if (lowerRaw.includes('pyro') || lowerBody.includes('pyro') || lowerBody === 'monox' || rawBody === 'pyro2' || rawBody === 'RR_P2_L4') {
                    systemName = 'Pyro';
                } else if (lowerRaw.includes('stanton') || lowerBody.includes('stanton') || 
                           ['hurston', 'crusader', 'arccorp', 'microtech', 'ariel', 'aberdeen', 'ita', 'magda', 'cellin', 'daymar', 'yela', 'lyria', 'wala', 'calliope', 'clio', 'euterpe'].includes(lowerBody)) {
                    systemName = 'Stanton';
                }
            } else {
                const details = this.getPlanetAndSystem(this.lastLocationRaw || chosenLocation, chosenLocation);
                planetName = details.planet || 'Unknown';
                systemName = details.system || 'Unknown';
            }

            this.emit('gamestate', {
                type: 'LOCATION',
                value: finalValue,
                source: chosenSource,
                planet: planetName,
                system: systemName,
                currentDisplayLocation: chosenLocation,
                currentLocationSource: chosenSource
            });
        }
    }
}

module.exports = new NavigationParser();
