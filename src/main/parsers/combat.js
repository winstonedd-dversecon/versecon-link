const BaseParser = require('./base');

/**
 * CombatParser - Death, Vehicle Destruction, and Hazard Detection (SC 4.6+)
 * 
 * REAL LOG FORMATS (from community research + MASTER_GUIDE):
 * 
 * ACTOR DEATH:
 *   <Actor Death> CActor::Kill: 'VictimName' [id] in zone 'location'
 *   killed by 'KillerName' [id] using 'WeaponName' [Class X]
 *   with damage type 'DamageType' from direction x: X, y: Y, z: Z
 * 
 * VEHICLE DESTRUCTION:
 *   <Vehicle Destruction> CVehicle::OnAdvanceDestroyLevel: Vehicle 'ANVL_Paladin_123' [id]
 *   in zone 'Stanton_Crusader_Port_Olisar' driven by 'DriverName' [id]
 *   advanced from destroy level 0 to 1 caused by 'AttackerName' [id]
 *   Destroy levels: 0=intact, 1=crippled/salvageable, 2=destroyed
 * 
 * NOTE: These patterns are from community research. Until verified against
 * a real log with combat, they remain best-effort implementations.
 */
class CombatParser extends BaseParser {
    constructor() {
        super();
        this.patterns = {
            // Actor Death — wide net first, then extract details
            actor_death: /<Actor Death>/,

            // Actual verified Actor State Dead (SC 4.6)
            // <[ActorState] Dead> [ACTOR STATE][CSCActorControlStateDead::PrePhysicsUpdate] Actor 'TypicallyBrit_ish' [204269884415] ejected from zone 'AEGS_Gladius_9490661802904' [9490661802904] to zone 'OOC_Stanton_2b_Daymar' [9431957087341]
            actor_state_dead: /<\[ActorState\] Dead>.*?Actor '([^']+)'\s*\[\d+\].*?from zone '([^']+)'\s*\[\d+\].*?to zone '([^']+)'/i,

            // Detailed death extraction (real format from MASTER_GUIDE)
            // Captures: victim, killer, weapon, damage type
            death_detailed: /<Actor Death>.*?'([^']+)'\s*\[\d+\].*?killed by\s+'([^']+)'\s*\[\d+\].*?using\s+'([^']+)'.*?damage type\s+'([^']+)'/i,

            // Zone from death line
            death_zone: /in zone\s+'([^']+)'/i,

            // Direction vector (for kill direction analysis)
            death_direction: /from direction\s+x:\s*([-\d.]+),?\s*y:\s*([-\d.]+),?\s*z:\s*([-\d.]+)/i,

            // CrimeStat Detection
            crimestat: /CrimeStat Rating (Increased|Decreased)/i,

            // Medical Dropoff Generation
            medical_dropoff: /DropoffLocation_BP\[Destination\],\s+locations:\s+\(([^\]]+)\s+\[([^\]]+)\]\)/i,

            // v2.10.3 - SC 4.0 Local Death Fallbacks
            simple_actor_death: /Actor\s+death/i,
            player_died: /Local\s+player\s+died/i,
            revive_triggered: /Player\s+Revive\s+Triggered/i,

            // Vehicle Destruction (destroy levels 0→1=crippled, 1→2=destroyed)
            vehicle_destruction: /<Vehicle Destruction>/,
            vehicle_destruction_detail: /<Vehicle Destruction>.*?Vehicle\s+'([^']+)'\s*\[\d+\].*?driven by\s+'([^']+)'\s*\[\d+\].*?from destroy level\s+(\d+)\s+to\s+(\d+).*?caused by\s+'([^']+)'/i,
            vehicle_destruction_zone: /in zone\s+'([^']+)'/i,

            // Hazards
            suffocating: /Player.*started suffocating/i,
            depressurizing: /Player.*started depressurization/i,
            // Fire: Primary — Snapshot Request + Similarity is guaranteed player-specific
            fire_actual: /<Fire Client - Snapshot Request> Fire Area '([^']+)'.*Similarity: [\d.]+ dB/i,
            // Fire: Secondary — Skip Initial Snapshot names the vehicle, only trigger if it matches our ship
            fire_ship_init: /<Fire Client - Skip Initial Snapshot> Fire Area '([^']+)' for vehicle '([^']+)'/i,

            // Tactical Proximity — Background Simulation Skipped fires for all nearby ships, not just ours
            // This is used to detect interdictor ships (e.g. Mantis, Cutlass Blue) by their room names
            proximity_fire: /\u003cFire Client - Background Simulation Skipped\u003e Fire Area '([^']+)'/i,

            fire_notification: /Added notification.*(?:Fire|fire)/i,

            // OCS Radar detection pattern (CItemResourceHost::AddHostedNode)
            ocs_radar: /\[CItemResourceHost::AddHostedNode\] Resource container component was already registered!\s+Entity\s*:\s*(\w+)_(\d+)\s+--\s+Host\s*:\s*(\w+)_(\d+)/i,

            // Corpse stream-in (corpse/death details)
            // Captures: "body_01_noMagicPocket_463403260094"
            corpse_stream: /<CSCActorCorpseUtils::PopulateItemPortForItemRecoveryEntitlement>.*?Item\s+'(body_01_noMagicPocket_\d+)/i,
        };

        // Track recent deaths for crew correlation (deaths within 200ms of vehicle destruction)
        this.recentDeaths = [];
        this.CREW_WINDOW_MS = 500;

        // Fire dedup: prevent spamming from multiple fire area logs in rapid succession
        this.lastFireAlert = 0;
        this.FIRE_COOLDOWN_MS = 10000; // 10 seconds between fire alerts

        // Tactical Proximity: list of interdictor ship name fragments (case-insensitive substring)
        this.interdictionShips = ['Mantis', 'AEGS_Mantis', 'Cutlass_Blue', 'DRAK_Cutlass_Blue', 'Zeus_Sentinel', 'Antares'];
        // Map of lastSeen timestamps per ship name to avoid repeated alerts
        this.lastProximityAlert = {};
        this.PROXIMITY_COOLDOWN_MS = 60000; // 60 seconds between alerts per ship
        // If true, only fire proximity alerts when currently in quantum travel
        this.interdictionQuantumOnly = true;
        // Track quantum travel state (set by jump drive log lines)
        this.inQuantum = false;

        // Reference to current ship (set by vehicle parser via main.js)
        this.currentShip = null;
        this.filterAIShips = false; // Filter AI ships setting

        // Character differentiation & OCS Radar State
        this.rsiHandle = '';
        this.recentOcsIds = new Map();
        this.radarBuffer = [];
        this.radarBufferTimeout = null;
        this.recentAlertedShips = [];
    }

    parse(line, context = {}) {
        let handled = false;

        // Skip parsing radar and threat events if we are doing historical catch-up
        if (context.initialRead) {
            // We still want to handle quantum state updates to set inQuantum state
            if (/Jump Drive Requesting State Change.*to Traveling/i.test(line)) {
                this.inQuantum = true;
            } else if (/Jump Drive Requesting State Change.*to Idle/i.test(line)) {
                this.inQuantum = false;
            }
            // If it's a radar match, mark it as handled so LogEngine knows we processed it, but don't emit anything
            if (this.patterns.ocs_radar.test(line) || this.patterns.proximity_fire.test(line) || /Local Route Guard - Server Rerouted/i.test(line)) {
                return true;
            }
            return false;
        }

        // ── 0. OCS Radar Detections ──
        const ocsMatch = line.match(this.patterns.ocs_radar);
        if (ocsMatch) {
            const entityName = ocsMatch[1];
            const entityId = ocsMatch[2];
            const hostName = ocsMatch[3];
            const hostId = ocsMatch[4];

            const now = Date.now();

            // Clean up 5-second cache
            for (const [id, ts] of this.recentOcsIds.entries()) {
                if (now - ts > 5000) {
                    this.recentOcsIds.delete(id);
                }
            }

            // De-duplicate: if we've seen either entityId or hostId in the last 5 seconds, skip
            if (!this.recentOcsIds.has(entityId) && !this.recentOcsIds.has(hostId)) {
                this.recentOcsIds.set(entityId, now);
                this.recentOcsIds.set(hostId, now);

                const chassisName = this.getCleanShipName(hostName);

                // Skip if this is the player's own ship
                const isOwnShip = this.currentShip && (
                    chassisName.toLowerCase().includes(this.currentShip.toLowerCase()) ||
                    this.currentShip.toLowerCase().includes(chassisName.toLowerCase())
                );

                const isAI = this.filterAIShips && this.isAIShip(entityName, hostName, chassisName);

                if (!isOwnShip && !isAI) {
                    // Add to buffer for burst grouping
                    this.radarBuffer.push({ chassisName, hostId, timestamp: now });
                }

                if (!this.radarBufferTimeout) {
                    this.radarBufferTimeout = setTimeout(() => {
                        this._flushRadarBuffer();
                    }, 300);
                }
            }
            handled = true;
        }

        // ── 1. Actor Death ──
        if (this.patterns.actor_death.test(line)) {
            const detail = line.match(this.patterns.death_detailed);
            if (detail) {
                const [_, victim, killer, weapon, damageType] = detail;
                const zoneMatch = line.match(this.patterns.death_zone);
                const dirMatch = line.match(this.patterns.death_direction);

                const isLocalPlayer = victim.toLowerCase() === (this.rsiHandle || '').toLowerCase();

                const payload = {
                    type: 'DEATH',
                    value: 'Killed',
                    details: {
                        victim,
                        killer,
                        weapon,
                        damageType,
                        isLocalPlayer,
                        zone: zoneMatch ? zoneMatch[1] : null,
                        direction: dirMatch ? {
                            x: parseFloat(dirMatch[1]),
                            y: parseFloat(dirMatch[2]),
                            z: parseFloat(dirMatch[3])
                        } : null
                    }
                };
                this.emit('gamestate', payload);

                // Track for crew correlation
                this.recentDeaths.push({ victim, timestamp: Date.now() });
                this._cleanOldDeaths();
            } else {
                // Fallback: detected <Actor Death> but couldn't parse details
                this.emit('gamestate', { type: 'STATUS', value: 'death' });
            }
            handled = true;
        }

        // ── 1.5 Verified Actor State Dead ──
        const stateDeadMatch = line.match(this.patterns.actor_state_dead);
        if (stateDeadMatch) {
            const victim = stateDeadMatch[1];
            const fromZone = stateDeadMatch[2];
            const toZone = stateDeadMatch[3];

            const isLocalPlayer = victim.toLowerCase() === (this.rsiHandle || '').toLowerCase();

            const payload = {
                type: 'DEATH',
                value: 'Killed',
                details: {
                    victim,
                    killer: 'Unknown',
                    weapon: 'Unknown',
                    damageType: 'Unknown',
                    isLocalPlayer,
                    zone: toZone, // where they ended up
                    fromZone: fromZone // usually the ship they died in
                }
            };
            this.emit('gamestate', payload);

            this.recentDeaths.push({ victim, timestamp: Date.now() });
            this._cleanOldDeaths();
            handled = true;
        }

        // ── 1.6 Corpse Stream-in (corpse/death details) ──
        const corpseMatch = line.match(this.patterns.corpse_stream);
        if (corpseMatch) {
            const corpseName = corpseMatch[1];
            this.emit('gamestate', {
                type: 'CORPSE_DETECTED',
                value: `Player corpse streamed in: ${corpseName}`,
                details: {
                    corpseId: corpseName
                }
            });
            handled = true;
        }

        // ── 2. Vehicle Destruction ──
        if (this.patterns.vehicle_destruction.test(line)) {
            const detail = line.match(this.patterns.vehicle_destruction_detail);
            if (detail) {
                const [_, vehicle, driver, fromLevel, toLevel, attacker] = detail;
                const zoneMatch = line.match(this.patterns.vehicle_destruction_zone);
                const isTotalLoss = parseInt(toLevel) >= 2;

                const payload = {
                    type: 'VEHICLE_DESTRUCTION',
                    value: isTotalLoss ? 'Ship Destroyed' : 'Ship Crippled',
                    details: {
                        vehicle: this._cleanVehicleName(vehicle),
                        vehicleRaw: vehicle,
                        driver,
                        attacker,
                        fromLevel: parseInt(fromLevel),
                        toLevel: parseInt(toLevel),
                        isTotalLoss,
                        zone: zoneMatch ? zoneMatch[1] : null,
                        // Crew correlation: find deaths within window
                        crewDeaths: this._getRecentCrewDeaths()
                    }
                };
                this.emit('gamestate', payload);

                // Also emit the legacy format for overlay compatibility
                if (isTotalLoss) {
                    this.emit('gamestate', { type: 'VEHICLE_DEATH', value: 'Critical Failure' });
                }
            } else {
                // Fallback
                this.emit('gamestate', { type: 'VEHICLE_DEATH', value: 'Vehicle Destroyed' });
            }
            handled = true;
        }

        // ── 3. Hazards ──
        if (this.patterns.suffocating.test(line)) {
            this.emit('gamestate', { type: 'STATUS', value: 'suffocating' });
            handled = true;
        }
        if (this.patterns.depressurizing.test(line)) {
            this.emit('gamestate', { type: 'STATUS', value: 'depressurizing' });
            handled = true;
        }
        // Fire detection — 3-tier approach
        const now = Date.now();
        let fireDetected = false;
        let fireRoom = null;
        let fireVehicle = null;

        // Tier 1: Snapshot Request + Similarity (always player-specific)
        const fireMatch = line.match(this.patterns.fire_actual);
        if (fireMatch) {
            fireDetected = true;
            fireRoom = fireMatch[1];
        }

        // Tier 2: Skip Initial Snapshot — only if vehicle matches our tracked ship
        if (!fireDetected) {
            const shipInit = line.match(this.patterns.fire_ship_init);
            if (shipInit && this.currentShip) {
                const vehicle = shipInit[2] || '';
                const shipLower = this.currentShip.toLowerCase();
                const vehLower = vehicle.toLowerCase();
                // Fuzzy match: "Crusader Intrepid" ↔ "CRUS_Intrepid_123456"
                const shipParts = shipLower.split(/[\s_-]+/).filter(p => p.length > 2);
                if (shipParts.some(part => vehLower.includes(part))) {
                    fireDetected = true;
                    fireRoom = shipInit[1];
                    fireVehicle = vehicle;
                }
            }
        }

        if (fireDetected && (now - this.lastFireAlert) > this.FIRE_COOLDOWN_MS) {
            this.lastFireAlert = now;
            this.emit('gamestate', {
                type: 'HAZARD_FIRE',
                value: 'Fire onboard!',
                room: fireRoom,
                vehicle: fireVehicle
            });
            handled = true;
        }

        // ── 5. CrimeStat Tracking ──
        const crimeMatch = line.match(this.patterns.crimestat);
        if (crimeMatch) {
            const direction = crimeMatch[1].toUpperCase(); // INCREASED or DECREASED

            // Emit a high priority security alert
            this.emit('gamestate', {
                type: 'STATUS',
                value: `CRIMESTAT ${direction}`,
                level: direction === 'INCREASED' ? 'CRITICAL' : 'INFO'
            });

            // If we also want it to pop an overlay alert directly:
            if (direction === 'INCREASED') {
                this.emit('gamestate', { type: 'CRIME_UPDATE', value: 'WANTED LEVEL INCREASED' });
            }

            handled = true;
        }

        // ── 6. Medical Respawn Points ──
        const medMatch = line.match(this.patterns.medical_dropoff);
        if (medMatch) {
            const clinicName = medMatch[1].trim();
            // We just grab the first bound location string (e.g. "Wikelo Emporium Dasi Station")
            this.emit('gamestate', {
                type: 'STATUS',
                value: `RESPAWN SET: ${clinicName}`,
                level: 'INFO'
            });
            handled = true;
        }

        // ── 7. Tactical Proximity Detection ──
        // When another ship's rooms are loaded into our instance (Fire Area Background Simulation),
        // it means that ship is in proximity. We check if it's an interdictor ship.
        //
        // Also track quantum state from jump drive log lines so we can gate alerts.
        if (/Jump Drive Requesting State Change.*to Traveling/i.test(line)) {
            this.inQuantum = true;
        } else if (/Jump Drive Requesting State Change.*to Idle/i.test(line)) {
            this.inQuantum = false;
        }

        // Detect ships arriving from quantum travel.
        // FinalStop=0 is the verified signal that a ship has just exited quantum drive and loaded into the area.
        // FinalStop=1 and FinalStop=-1 are unreliable (appear on grounded/static entities) and are ignored.
        if (line.includes('Local Route Guard - Server Rerouted')) {
            const finalStopMatch = line.match(/FinalStop=(-?\d+)/i);
            const finalStop = finalStopMatch ? parseInt(finalStopMatch[1]) : null;

            // Only process FinalStop=0 (confirmed quantum arrival signal)
            if (finalStop === 0) {
                // Try to extract ship entity name from the line
                // Matches: RSI_Hermes_509694187799[509694187799] or DRAK_Corsair_512402756909[...]
                const entityMatch = line.match(/\|\s*([A-Za-z]+_[A-Za-z]+_[A-Za-z0-9_]+)\[\d+\]/i);
                let shipName = 'Unknown Ship';
                if (entityMatch && entityMatch[1]) {
                    shipName = this.getCleanShipName(entityMatch[1]);
                }

                const isOwnShip = this.currentShip && (
                    shipName.toLowerCase().includes(this.currentShip.toLowerCase()) ||
                    this.currentShip.toLowerCase().includes(shipName.toLowerCase())
                );

                if (!isOwnShip && shipName !== 'Unknown Ship') {
                    const actionMsg = `${shipName} — Quantum Arrival`;
                    this.emit('gamestate', {
                        type: 'TACTICAL_QUANTUM',
                        value: actionMsg,
                        ship: shipName,
                        direction: 'arrival'
                    });
                    handled = true;
                }
            }
        }

        const proxMatch = line.match(this.patterns.proximity_fire);
        if (proxMatch && this.interdictionShips.length > 0) {
            // Gate: if quantumOnly mode is on, skip unless we're currently in quantum
            const shouldCheck = !this.interdictionQuantumOnly || this.inQuantum;
            if (shouldCheck) {
                const roomName = proxMatch[1]; // e.g. 'Room_Mantis_Cockpit-001'
                for (const shipFragment of this.interdictionShips) {
                    const frag = shipFragment.toLowerCase();
                    if (roomName.toLowerCase().includes(frag)) {
                        const now = Date.now();
                        const lastAlert = this.lastProximityAlert[frag] || 0;
                        if ((now - lastAlert) > this.PROXIMITY_COOLDOWN_MS) {
                            this.lastProximityAlert[frag] = now;
                            this.emit('gamestate', {
                                type: 'TACTICAL_PROXIMITY',
                                value: 'Interdiction ship detected nearby',
                                ship: shipFragment,
                                room: roomName,
                                inQuantum: this.inQuantum
                            });
                            handled = true;
                        }
                        break;
                    }
                }
            }
        }

        return handled;
    }

    /**
     * Update the list of interdictor ship name fragments to detect.
     * Called by LogEngine when config changes.
     * @param {string[]} ships 
     */
    setInterdictionShips(ships) {
        this.interdictionShips = Array.isArray(ships) ? ships : [];
        // Reset cooldowns when list changes so new additions trigger immediately
        this.lastProximityAlert = {};
        console.log('[CombatParser] Interdiction ship list updated:', this.interdictionShips);
    }

    /**
     * Set whether proximity alerts only fire during quantum travel.
     * @param {boolean} quantumOnly 
     */
    setInterdictionQuantumOnly(quantumOnly) {
        this.interdictionQuantumOnly = !!quantumOnly;
        console.log('[CombatParser] Interdiction quantum-only mode:', this.interdictionQuantumOnly);
    }

    /**
     * Set whether AI ships should be filtered out from OCS radar.
     * @param {boolean} enabled
     */
    setFilterAIShips(enabled) {
        this.filterAIShips = !!enabled;
        console.log('[CombatParser] Filter AI ships mode:', this.filterAIShips);
    }

    /**
     * Check if the entity, host, or chassis name matches known AI/NPC patterns
     */
    isAIShip(entityName, hostName, chassisName) {
        const aiPatterns = [/AI_/i, /NPC_/i, /PU_Pilot_/i, /Criminal-Pilot/i, /Security-/i, /Pirate-/i];
        
        // Check explicit pattern matches in entityName and hostName
        for (const pattern of aiPatterns) {
            if (pattern.test(entityName) || pattern.test(hostName)) {
                return true;
            }
        }

        // Heuristics:
        // 1. Long entity names with multiple hyphens or underscores (e.g. PU_Pilot_Pirate_Cutlass_Black_...)
        const hyphenCount = (entityName.match(/[-_]/g) || []).length;
        if (entityName.length > 40 || hyphenCount > 3) {
            if (/^(?:PU_|AI_|NPC_|Criminal|Security|Pirate)/i.test(entityName)) {
                return true;
            }
        }

        // Clean name check
        if (chassisName) {
            const cleanLower = chassisName.toLowerCase();
            if (cleanLower.startsWith('ai ') || cleanLower.startsWith('npc ') || cleanLower.includes(' npc') || cleanLower.includes(' ai ')) {
                return true;
            }
        }

        return false;
    }

    /** Strip trailing entity ID and convert underscores */
    _cleanVehicleName(raw) {
        if (!raw) return 'Unknown';
        let cleaned = raw.replace(/_\d{10,}$/, '');
        return cleaned.replace(/_/g, ' ').trim() || raw;
    }

    /** Get deaths within the crew correlation window */
    _getRecentCrewDeaths() {
        this._cleanOldDeaths();
        return this.recentDeaths.map(d => d.victim);
    }

    /** Remove deaths older than correlation window */
    _cleanOldDeaths() {
        const cutoff = Date.now() - this.CREW_WINDOW_MS;
        this.recentDeaths = this.recentDeaths.filter(d => d.timestamp > cutoff);
    }

    /** Set user's RSI handle for player/other separation */
    setRsiHandle(handle) {
        this.rsiHandle = handle;
        console.log('[CombatParser] RSI handle updated:', this.rsiHandle);
    }

    /** Process and emit grouped or single radar detections */
    _flushRadarBuffer() {
        const now = Date.now();
        const ships = this.radarBuffer;
        this.radarBuffer = [];
        this.radarBufferTimeout = null;

        if (ships.length === 0) return;

        // Clean up 15-second rolling history of alerted unique ships (using hostId)
        this.recentAlertedShips = this.recentAlertedShips.filter(s => now - s.timestamp <= 15000);

        // Filter out duplicates within this buffer burst itself, and also check against the 15s history
        const uniqueShips = [];
        const seenIds = new Set();
        for (const s of ships) {
            // Check if seen in this burst
            if (seenIds.has(s.hostId)) continue;
            seenIds.add(s.hostId);

            // Check if seen in the 15-second history
            const alreadyAlerted = this.recentAlertedShips.some(historyShip => historyShip.id === s.hostId);
            if (alreadyAlerted) continue;

            uniqueShips.push(s);
        }

        if (uniqueShips.length === 0) return;

        // Add newly alerted unique ships to sliding 15s history
        for (const s of uniqueShips) {
            this.recentAlertedShips.push({ name: s.chassisName, id: s.hostId, timestamp: now });
        }

        if (uniqueShips.length > 3) {
            const uniqueNames = [...new Set(uniqueShips.map(s => s.chassisName))];
            const payload = {
                type: 'RADAR_GROUP',
                value: `Area Loaded: ${uniqueShips.length} ships nearby (List: ${uniqueNames.join(', ')})`,
                details: {
                    count: uniqueShips.length,
                    ships: uniqueNames
                }
            };
            this.emit('gamestate', payload);
        } else {
            for (const s of uniqueShips) {
                const payload = {
                    type: 'RADAR_SINGLE',
                    value: `Ship detected: ${s.chassisName}`,
                    details: {
                        chassis: s.chassisName,
                        hostId: s.hostId
                    }
                };
                this.emit('gamestate', payload);
            }
        }
    }
}

module.exports = new CombatParser();

