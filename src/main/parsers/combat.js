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

            fire_notification: /Added notification.*(?:Fire|fire)/i,
        };

        // Track recent deaths for crew correlation (deaths within 200ms of vehicle destruction)
        this.recentDeaths = [];
        this.CREW_WINDOW_MS = 500;

        // Fire dedup: prevent spamming from multiple fire area logs in rapid succession
        this.lastFireAlert = 0;
        this.FIRE_COOLDOWN_MS = 10000; // 10 seconds between fire alerts

        // Reference to current ship (set by vehicle parser via main.js)
        this.currentShip = null;
    }

    parse(line) {
        let handled = false;

        // ── 1. Actor Death ──
        if (this.patterns.actor_death.test(line)) {
            const detail = line.match(this.patterns.death_detailed);
            if (detail) {
                const [_, victim, killer, weapon, damageType] = detail;
                const zoneMatch = line.match(this.patterns.death_zone);
                const dirMatch = line.match(this.patterns.death_direction);

                const payload = {
                    type: 'DEATH',
                    value: 'Killed',
                    details: {
                        victim,
                        killer,
                        weapon,
                        damageType,
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

            const payload = {
                type: 'DEATH',
                value: 'Killed',
                details: {
                    victim,
                    killer: 'Unknown',
                    weapon: 'Unknown',
                    damageType: 'Unknown',
                    zone: toZone, // where they ended up
                    fromZone: fromZone // usually the ship they died in
                }
            };
            this.emit('gamestate', payload);

            this.recentDeaths.push({ victim, timestamp: Date.now() });
            this._cleanOldDeaths();
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

        return handled;
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
}

module.exports = new CombatParser();

