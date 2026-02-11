const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { EventEmitter } = require('events');

class LogWatcher extends EventEmitter {
    constructor() {
        super();
        this.watcher = null;
        this.filePath = null;
        this.isWatching = false;
        this.lastSize = 0;
        this.lastLocationHint = null;
        this.seenLocations = new Set();

        // Current state tracking
        this.currentShip = null;
        this.currentServer = null;
        this.spawnPoint = null;
        this.partyMembers = new Set();

        // Unknown log discovery
        this.unknownGroups = new Map(); // key -> { sample, count, firstSeen, lastSeen }
        this.unknownIgnored = new Set(); // user-ignored patterns
        this.captureUnknowns = true;

        // v2.2 - Ship Image Mapping
        this.shipMap = {}; // { "Clipper": "/path/to/image.png" }

        // Alert cooldowns: { alertType: { cooldownMs, lastFired } }
        this.alertCooldowns = {};

        // Noise filter — skip extremely common/uninteresting CryEngine INTERNAL lines
        // IMPORTANT: Do NOT filter [Notice], [Error], [Trace] — those contain game events!
        this.noisePatterns = [
            /^\s*$/,
            /CryAnimation/i,
            /CEntityComponentPhysics/i,
            /SEntityPhysics/i,
            /CParticleEffect/i,
            /CFlowGraph/i,
            /CryAction/i,
            /pak_cache/i,
            /^\s*\d+\.\d+\s*$/,  // bare numbers only
            /PSOCacheGen/i,
            /VK_LAYER_/,
            /\[VK_INFO\]/,
            /\[VK\] Available Vulkan/,
            /grpc\.\w+=/,          // gRPC config lines
            /RegisterUniverseHierarchy/,
            /ContextEstablisher/,  // Loading state machine spam
            /CContextEstablisher/,
            /CVARS.*Not Whitelisted/,
            /Subsumption.*ErrorReporter/,
            /SubsumptionManager/,
            /CIG\s*$/,
            /^\s*-\s+Adapter index/,
            /^\s*-\s+Dedicated video memory/,
            /^\s*-\s+Feature level/,
            /^\s*-\s+Displays connected/,
            /^\s*-\s+Suitable rendering/,
            /grpc\.primary_user_agent/,
            /grpc\.http2/,
            /grpc\.max_/,
            /grpc\.keepalive/,
            /grpc\.default_compression/,
            /===== PSOs Skipped/,
            /SysSpec mismatch/,
            /Shader not found/,
            /Technique not found/,
            /Unsupported PSO/,
            /RegisterOCHierarchyData/,
            /WaitForOCHierarchyData/,
            /CacheSolarSystemStreaming/,
            /BindSolarSystem/,
            /BindAlwaysStreamedIn/,
            /BindAllStreamable/,
            /GrantPlayerOwnedTokens/,
            /ModelWaitForViews/,
            /SeedingProcessor/,
            /Entity Bury Request/,
            /DestroyEntity.*Aggregate/,
            /Failed to attach to itemport/,
        ];


        // v2.2 - Editable Patterns Architecture
        // Load defaults, then apply overrides
        this.patterns = Object.assign({}, LogWatcher.DEFAULT_PATTERNS);
        this.patternOverrides = {}; // { key: { regex: '...', disabled: true } }
    }

    static DEFAULT_PATTERNS = {
        // === Star Citizen 4.0+ Patterns ===
        // Connection & Identity
        geid: /geid\s+(\d+)/,
        player_name: /name\s+(.+?)\s+-\s+/,
        legacy_login: /Legacy login response.*Handle\[(\w+)\]/,

        // Server & Environment
        server_env: /\[Trace\] Environment:\s+(\w+)/,
        server_session: /@session:\s+'([^']+)'/,
        server_region: /grpc-client-endpoint-override='https:\/\/(\w+)-/,

        // Location & Inventory
        location: /Location\[([^\]]+)\]/i,
        inventory_request: /<RequestLocationInventory>/,
        loading_screen: /CGlobalGameUI::OpenLoadingScreen/,
        loading_game_mode: /Loading GameModeRecord='(\w+)'/,

        // Vehicle Control Flow (Entering/Exiting/Spawn)
        vehicle_control: /<Vehicle Control Flow>/,
        vehicle_name: /for\s+'([^']+)'/,
        vehicle_entity_id: /for\s+'[^']+'\s+\[(\d+)\]/,
        player_entity_id: /Local client node \[(\d+)\]/,
        starmap_nav: /([A-Za-z_0-9]+)\[(\d+)\]\|CSCItemNavigation::GetStarmapRouteSegmentData/,

        // Quantum Drive
        quantum_arrival: /<Quantum Drive Arrived/,
        quantum_request: /<Jump Drive Requesting State Change>/,
        quantum_zone: /\((?:\w+):\s+([A-Z_0-9]+(?:_\d+)?)\s+in\s+zone\s+([^\)]+)\)/,

        // Medical & Spawn
        spawn_flow: /<Spawn Flow>/,
        spawn_point_reservation: /lost\s+reservation\s+for\s+spawnpoint\s+([^\\s]+)\s+\[(\d+)\]\s+at\s+location\s+(\d+)/,
        medical_bed_detachment: /<CEntity::OnOwnerRemoved>.*bed/i,
        medical_bed_any: /medical bed/i,

        // Status & Damage
        actor_death: /<Actor Death>/,
        actor_state_dead: /<\[ActorState\] Dead>/,
        destruction: /Destruction>/,
        fatal_collision: /<FatalCollision>/,
        suffocating: /Player.*started suffocating/i,
        depressurizing: /Player.*started depressurization/i,

        // Missions & Objectives
        mission_shared: /<MissionShared>/,
        mission_objective: /<ObjectiveUpserted>/,
        mission_ended: /<MissionEnded>/,
        mission_end_structured: /<EndMission>/,
        bounty_marker: /<CLocalMissionPhaseMarker::CreateMarker>/,

        // Interaction
        item_placement: /<\[ActorState\] Place>/,
        equip_item: /<EquipItem>/,
        docking_platform: /<CSCLoadingPlatformManager>/,

        // Hazards & Misc
        hazard_fire: /Fire detected/i,
        location_obj: /objectcontainers\/pu\/loc\/(?:flagship|mod)\/([^\/]+)\/([^\/]+)\//,
        ship_exit_confirm: /<Vehicle Control Flow>.*releasing/i
    };

    findLogFile() {
        const candidates = [];

        // Windows paths
        const drivers = ['C:', 'D:', 'E:', 'F:'];
        const winPaths = [
            'Program Files/Roberts Space Industries/StarCitizen/LIVE/Game.log',
            'Program Files/Roberts Space Industries/StarCitizen/PTU/Game.log',
            'Program Files/Roberts Space Industries/StarCitizen/EPTU/Game.log',
            'Program Files/Roberts Space Industries/StarCitizen/TECH-PREVIEW/Game.log',
            'Program Files/Roberts Space Industries/Star Citizen/LIVE/Game.log',
            'Program Files/Roberts Space Industries/Star Citizen/PTU/Game.log',
            'Roberts Space Industries/StarCitizen/LIVE/Game.log',
            'StarCitizen/LIVE/Game.log',
        ];
        for (const drive of drivers) {
            for (const p of winPaths) {
                candidates.push(path.join(drive, p));
            }
        }

        // Linux paths (Wine / Lutris / Proton)
        const home = process.env.HOME || process.env.USERPROFILE || '';
        if (home) {
            candidates.push(
                path.join(home, '.wine/drive_c/Program Files/Roberts Space Industries/Star Citizen/LIVE/Game.log'),
                path.join(home, 'Games/star-citizen/drive_c/Program Files/Roberts Space Industries/Star Citizen/LIVE/Game.log'),
                path.join(home, '.local/share/lutris/runners/wine/star-citizen/Game.log')
            );
        }

        // macOS paths (CrossOver)
        if (home) {
            candidates.push(
                path.join(home, 'Library/Application Support/CrossOver/Bottles/Star Citizen/drive_c/Program Files/Roberts Space Industries/Star Citizen/LIVE/Game.log')
            );
        }

        // Project-local fallback (for development/testing)
        candidates.push(
            path.join(__dirname, '..', 'Game.log')
        );

        for (const fullPath of candidates) {
            if (fs.existsSync(fullPath)) {
                return fullPath;
            }
        }
        return null;
    }

    /**
     * Read the last N lines from a file (for initial state parsing)
     */
    readLastLines(filePath, maxLines = 10000) {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n');
            return lines.slice(-maxLines);
        } catch (e) {
            console.error('[LogWatcher] Failed to read file:', e.message);
            return [];
        }
    }

    start(customPath = null) {
        if (this.isWatching) return;

        this.filePath = customPath || this.findLogFile();

        if (!this.filePath) {
            this.emit('error', 'Game.log not found. Please locate it manually via Configuration tab.');
            return;
        }

        console.log(`[LogWatcher] Starting on: ${this.filePath}`);
        this.emit('status', { connected: true, path: this.filePath });

        // STEP 1: Process existing file content
        console.log('[LogWatcher] Reading existing log content...');
        this.seenLocations.clear();
        const existingLines = this.readLastLines(this.filePath, 50000);
        let matchCount = 0;
        for (const line of existingLines) {
            if (this.processLine(line, true)) matchCount++;
        }
        console.log(`[LogWatcher] Initial scan complete: ${matchCount} events found in ${existingLines.length} lines`);

        // Emit initial state after scan
        this.emitCurrentState();

        // STEP 2: Watch for NEW lines appended to the file
        try {
            const stat = fs.statSync(this.filePath);
            this.lastSize = stat.size;

            // Use fs.watchFile for reliable cross-platform polling
            fs.watchFile(this.filePath, { interval: 1000 }, (curr, prev) => {
                if (curr.size > this.lastSize) {
                    // Read only the new bytes
                    const stream = fs.createReadStream(this.filePath, {
                        start: this.lastSize,
                        end: curr.size - 1,
                        encoding: 'utf-8'
                    });

                    let buffer = '';
                    stream.on('data', (chunk) => { buffer += chunk; });
                    stream.on('end', () => {
                        const newLines = buffer.split('\n');
                        for (const line of newLines) {
                            if (line.trim()) this.processLine(line, false);
                        }
                    });
                    stream.on('error', (err) => this.emit('error', err.message));

                    this.lastSize = curr.size;
                } else if (curr.size < this.lastSize) {
                    // File was truncated (game restarted), reset
                    console.log('[LogWatcher] File truncated - game may have restarted');
                    this.lastSize = curr.size;
                    this.currentShip = null;
                    this.currentServer = null;
                    this.emit('gamestate', { type: 'GAME_RESTART', value: 'restarted' });
                }
            });

            this.isWatching = true;
            console.log('[LogWatcher] Now watching for new log entries...');
        } catch (e) {
            this.emit('error', `Failed to watch file: ${e.message}`);
        }
    }

    // Emit accumulated state (for initial read)
    emitCurrentState() {
        if (this.currentShip) {
            this.emit('gamestate', { type: 'SHIP_CURRENT', value: this.currentShip });
        }
        if (this.currentServer) {
            this.emit('gamestate', { type: 'SERVER_ENV', value: this.currentServer });
        }
        if (this.spawnPoint) {
            this.emit('gamestate', { type: 'SPAWN_POINT', value: this.spawnPoint });
        }
    }

    stop() {
        if (this.filePath) {
            fs.unwatchFile(this.filePath);
        }
        this.isWatching = false;
        this.emit('status', { connected: false });
    }

    setPath(newPath) {
        console.log(`[LogWatcher] Switching to manual path: ${newPath}`);
        this.stop();
        this.start(newPath);
    }

    // Set alert cooldown (from Settings)
    setAlertCooldown(alertType, cooldownMs) {
        this.alertCooldowns[alertType] = { cooldownMs, lastFired: 0 };
    }

    // Check if alert should be suppressed
    shouldSuppressAlert(alertType) {
        const cd = this.alertCooldowns[alertType];
        if (!cd || cd.cooldownMs <= 0) return false;
        const now = Date.now();
        if (now - cd.lastFired < cd.cooldownMs) return true;
        cd.lastFired = now;
        return false;
    }

    // v2.2 - Set ship image mapping
    setShipMap(map) {
        this.shipMap = map || {};
    }

    // v2.2 - Set custom log patterns (manual entry)
    setCustomPatterns(patterns) {
        this.customPatterns = patterns || [];
        this.compiledCustomPatterns = this.customPatterns.map(p => {
            try {
                // p.regex is string, e.g. "Time: (\\d+)"
                // Convert to RegExp, stripping surrounding slashes if present
                let regexBody = p.regex;
                let flags = '';

                if (regexBody.startsWith('/') && regexBody.lastIndexOf('/') > 0) {
                    const lastSlash = regexBody.lastIndexOf('/');
                    flags = regexBody.substring(lastSlash + 1);
                    regexBody = regexBody.substring(1, lastSlash);
                }

                return { ...p, compiled: new RegExp(regexBody, flags) };
            } catch (e) {
                console.error('[LogWatcher] Invalid custom regex:', p.regex, e);
                return null;
            }
        }).filter(Boolean);
    }

    // v2.2 - Override built-in patterns
    setPatternOverrides(overrides) {
        this.patternOverrides = overrides || {};
        // Rebuild this.patterns from Defaults + Overrides
        const newPatterns = Object.assign({}, LogWatcher.DEFAULT_PATTERNS);

        for (const [key, config] of Object.entries(this.patternOverrides)) {
            if (config.disabled) {
                // Set to a regex that never matches
                newPatterns[key] = /$^/;
            } else if (config.regex) {
                try {
                    // Recompile regex
                    let regexBody = config.regex;
                    let flags = '';
                    if (regexBody.startsWith('/') && regexBody.lastIndexOf('/') > 0) {
                        const lastSlash = regexBody.lastIndexOf('/');
                        flags = regexBody.substring(lastSlash + 1);
                        regexBody = regexBody.substring(1, lastSlash);
                    }
                    newPatterns[key] = new RegExp(regexBody, flags);
                } catch (e) {
                    console.error(`[LogWatcher] Invalid override regex for ${key}:`, e);
                }
            }
        }
        this.patterns = newPatterns;
    }

    /**
     * getCleanShipName
     * Ported logic from Picologs to clean technical ship names
     */
    getCleanShipName(rawName) {
        if (!rawName) return 'Ship';
        if (rawName === 'unknown') return 'Unknown';

        // 1. Remove company prefixes (AEGS_, ANVL_, etc)
        let name = rawName.replace(/^[A-Z]{3,4}_/, (match) => {
            const map = {
                'AEGS_': 'Aegis ',
                'ANVL_': 'Anvil ',
                'DRAK_': 'Drake ',
                'MISC_': 'MISC ',
                'RSI_': 'RSI ',
                'ORIG_': 'Origin ',
                'CRUS_': 'Crusader ',
                'ARGO_': 'ARGO ',
                'CNOU_': 'CO ',
                'BANU_': 'Banu ',
                'AOPOA_': 'Aopoa ',
                'ESPR_': 'Esperia ',
                'GATM_': 'Gatac ',
                'MIRA_': 'Mirai ',
            };
            return map[match] || match.replace('_', ' ');
        });

        // 2. Remove technical ID suffixes (_123456789)
        name = name.replace(/_\d+$/, '');

        // 3. Clean underscores to spaces
        name = name.replace(/_/g, ' ');

        return name.trim();
    }

    processLine(line, initialRead = false) {
        if (!line || !line.trim()) return false;

        // Skip noise
        if (this.noisePatterns.some(p => p.test(line))) return false;

        let matched = false;

        // 1. Connection & Identity
        const geidMatch = line.match(this.patterns.geid);
        const nameMatch = line.match(this.patterns.player_name);
        if (geidMatch && nameMatch) {
            const playerName = nameMatch[1];
            this.emit('gamestate', { type: 'PLAYER_NAME', value: playerName });
            this.emit('login', { status: 'connected', handle: playerName });
            matched = true;
        }

        const legacyLogin = line.match(this.patterns.legacy_login);
        if (legacyLogin && !matched) {
            this.emit('gamestate', { type: 'PLAYER_NAME', value: legacyLogin[1] });
            this.emit('login', { status: 'connected', handle: legacyLogin[1] });
            matched = true;
        }

        // 2. Server & Environment
        const envMatch = line.match(this.patterns.server_env);
        if (envMatch) {
            this.currentServer = envMatch[1];
            this.emit('gamestate', { type: 'SERVER_ENV', value: envMatch[1] });
            matched = true;
        }

        const sessionMatch = line.match(this.patterns.server_session);
        if (sessionMatch) {
            this.emit('gamestate', { type: 'SESSION_ID', value: sessionMatch[1] });
            matched = true;
        }

        // 3. Location & Inventory
        const isInventory = this.patterns.inventory_request.test(line);
        const locationMatch = line.match(this.patterns.location);
        if (locationMatch) {
            let val = locationMatch[1];
            // v2.2 - Prettify location (e.g. OOC_Stanton_1b_Aberdeen -> Aberdeen)
            val = val.replace(/^OOC_/, '').replace(/Stanton_\d+[a-z]?_/, '').replace(/_/g, ' ');

            this.emit('gamestate', { type: 'LOCATION', value: val });
            if (isInventory) this.emit('gamestate', { type: 'INVENTORY', value: 'opened' });
            matched = true;
        }

        // 4. Vehicle Control Flow (Entering/Exiting/Spawn)
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
                    this.currentShip = null;
                    this.emit('gamestate', { type: 'SHIP_EXIT', value: cleanedName });
                }
                matched = true;
            }
        }

        // Fallbacks for ship detection
        if (!matched && this.currentShip === null) {
            const starmapMatch = line.match(this.patterns.starmap_nav);
            if (starmapMatch) {
                const cleanedName = this.getCleanShipName(starmapMatch[1]);
                this.currentShip = cleanedName;
                this.emit('gamestate', { type: 'SHIP_ENTER', value: cleanedName });
                matched = true;
            }
        }

        // v2.2 - Ship Exit Confirmation Fallback
        if (!matched && this.patterns.ship_exit_confirm.test(line)) {
            if (this.currentShip) {
                this.emit('gamestate', { type: 'SHIP_EXIT', value: this.currentShip });
                this.currentShip = null;
            }
            matched = true;
        }

        // 5. Medical & Spawn
        if (this.patterns.spawn_flow.test(line)) {
            const spawnMatch = line.match(this.patterns.spawn_point_reservation);
            if (spawnMatch) {
                const loc = spawnMatch[1].replace(/_/g, ' ');
                this.spawnPoint = loc;
                this.emit('gamestate', { type: 'SPAWN_SET', value: loc });
                matched = true;
            }
        }

        if (this.patterns.medical_bed_any.test(line)) {
            if (line.includes('Entering')) {
                this.emit('gamestate', { type: 'MEDICAL_BED', value: 'entered' });
                matched = true;
            }
        }
        if (this.patterns.medical_bed_detachment.test(line)) {
            this.emit('gamestate', { type: 'MEDICAL_BED', value: 'left' });
            matched = true;
        }

        // 6. Quantum
        if (line.includes('Quantum Drive Arrived')) {
            this.emit('gamestate', { type: 'QUANTUM', value: 'arrived' });
            matched = true;
        }
        const qRequest = line.match(this.patterns.quantum_request);
        if (qRequest || line.includes('Jump Drive Requesting State Change')) {
            if (line.includes('to Traveling')) {
                this.emit('gamestate', { type: 'QUANTUM', value: 'entered' });
            } else if (line.includes('to Idle')) {
                this.emit('gamestate', { type: 'QUANTUM', value: 'exited' });
            }
            matched = true;
        }

        // 7. Status & Death / Hazards
        if (this.patterns.actor_death.test(line) || this.patterns.actor_state_dead.test(line)) {
            this.emit('gamestate', { type: 'STATUS', value: 'death' });
            matched = true;
        }
        if (this.patterns.suffocating.test(line)) {
            if (!this.shouldSuppressAlert('suffocating')) {
                this.emit('gamestate', { type: 'STATUS', value: 'suffocating' });
            }
            matched = true;
        }
        if (this.patterns.depressurizing.test(line)) {
            if (!this.shouldSuppressAlert('depressurizing')) {
                this.emit('gamestate', { type: 'STATUS', value: 'depressurizing' });
            }
            matched = true;
        }
        if (this.patterns.hazard_fire.test(line)) {
            if (!this.shouldSuppressAlert('fire')) {
                this.emit('gamestate', { type: 'HAZARD_FIRE', value: 'Fire Detected' });
            }
            matched = true;
        }

        // 8. Missions
        if (this.patterns.mission_shared.test(line)) {
            this.emit('gamestate', { type: 'MISSION', value: 'shared' });
            matched = true;
        }
        if (this.patterns.mission_objective.test(line)) {
            this.emit('gamestate', { type: 'MISSION', value: 'update' });
            matched = true;
        }
        if (this.patterns.mission_ended.test(line) || this.patterns.mission_end_structured.test(line)) {
            this.emit('gamestate', { type: 'MISSION', value: 'ended' });
            matched = true;
        }

        // 9. Location Hints (Object Containers)
        const objMatch = line.match(this.patterns.location_obj) || line.match(/objectcontainers\/pu\/loc\/(?:flagship|mod)\/([^\/]+)\/([^\/]+)\//);
        if (objMatch) {
            const system = objMatch[1];
            const location = objMatch[2];
            const key = `${system}/${location}`;
            if (key !== this.lastLocationHint) {
                this.lastLocationHint = key;
                this.emit('gamestate', { type: 'LOCATION_HINT', value: key });
                matched = true;
            }
        }

        // v2.2 - User-defined Custom Patterns
        if (this.compiledCustomPatterns) {
            for (const p of this.compiledCustomPatterns) {
                const customMatch = line.match(p.compiled);
                if (customMatch) {
                    this.emit('gamestate', {
                        type: 'CUSTOM',
                        level: p.level || 'INFO',
                        message: p.message ? p.message.replace('$1', customMatch[1] || '').replace('$2', customMatch[2] || '') : 'Custom Match',
                        value: customMatch[1] || line
                    });
                    matched = true;
                }
            }
        }

        if (matched) return true;

        // Default: just emit raw for debug
        this.emit('raw-line', line);

        // === UNKNOWN DISCOVERY ===
        if (!this.captureUnknowns) return false;
        if (initialRead) return false;

        let cleaned = line
            .replace(/<[^>]+>/g, '')
            .replace(/^<\d{4}-\d{2}-\d{2}T[\d:.]+Z>\s*/, '')
            .replace(/^\[(Notice|Error|Trace|Warning|Info)\]\s*/, '')
            .trim();

        if (cleaned.length < 15) return false;
        this.captureUnknownLine(cleaned);
        return false;
    }

    // Improved unknown line grouping — shows actual log content
    captureUnknownLine(line) {
        // Skip noise
        for (const noise of this.noisePatterns) {
            if (noise.test(line)) return;
        }

        // Skip very short lines
        const trimmed = line.trim();
        if (trimmed.length < 15) return;

        // Strip timestamp prefix: <2026-02-09T23:19:26.021Z>
        let cleaned = trimmed.replace(/^<\d{4}-\d{2}-\d{2}T[\d:.]+Z>\s*/, '');

        // Strip severity prefix: [Notice] [Error] [Trace] [Warning]
        cleaned = cleaned.replace(/^\[(Notice|Error|Trace|Warning|Info)\]\s*/, '');

        // Extract a meaningful group key
        let key;

        // Try 1: <EventName> pattern (most SC events)
        const eventMatch = cleaned.match(/^<([^>]{3,60})>/);
        if (eventMatch) {
            key = eventMatch[1];
        }
        // Try 2: CClassName::Method or CClassName pattern
        else {
            const classMatch = cleaned.match(/^(C?[A-Z][A-Za-z0-9]+(?:::[A-Za-z0-9_]+)?)/);
            if (classMatch && classMatch[1].length > 3) {
                key = classMatch[1];
            }
            // Try 3: [Tag] prefix
            else {
                const tagMatch = cleaned.match(/^\[([^\]]{2,40})\]/);
                if (tagMatch) {
                    key = `[${tagMatch[1]}]`;
                }
                // Try 4: First meaningful phrase (up to 60 chars, at word boundary)
                else {
                    const phrase = cleaned.substring(0, 80);
                    const wordBound = phrase.lastIndexOf(' ', 60);
                    key = wordBound > 20 ? phrase.substring(0, wordBound) : phrase.substring(0, 60);
                }
            }
        }

        // Check if ignored
        if (this.unknownIgnored.has(key)) return;

        const now = new Date().toISOString();
        if (this.unknownGroups.has(key)) {
            const group = this.unknownGroups.get(key);
            group.count++;
            group.lastSeen = now;
            // Update sample if this line is more descriptive
            if (cleaned.length > group.sample.length && cleaned.length <= 300) {
                group.sample = cleaned;
            }
        } else {
            // Cap at 200 groups
            if (this.unknownGroups.size >= 200) {
                // Remove oldest group
                const oldest = this.unknownGroups.keys().next().value;
                this.unknownGroups.delete(oldest);
            }
            this.unknownGroups.set(key, {
                group: key,
                sample: cleaned.substring(0, 300),
                count: 1,
                firstSeen: now,
                lastSeen: now
            });
        }

        // Emit periodically (every 10 new unknowns)
        const total = Array.from(this.unknownGroups.values()).reduce((s, g) => s + g.count, 0);
        if (total % 10 === 0) {
            this.emitUnknowns();
        }
    }

    emitUnknowns() {
        const groups = Array.from(this.unknownGroups.values())
            .sort((a, b) => b.count - a.count);
        this.emit('unknown', { groups, totalGroups: groups.length });
    }

    ignoreUnknownPattern(key) {
        this.unknownIgnored.add(key);
        this.unknownGroups.delete(key);
        this.emitUnknowns();
    }

    clearUnknowns() {
        this.unknownGroups.clear();
        this.emitUnknowns();
    }
}

module.exports = new LogWatcher();
