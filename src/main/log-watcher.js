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
        // === LOGIN & IDENTITY ===
        login_success: /CDisciplineServiceExternal::OnLoginStatusChanged.*LoggedIn/,
        login_completed: /LoginCompleted.*message/,
        legacy_login: /Legacy login response.*Handle\[(\w+)\]/,  // RSI Handle
        player_geid: /playerGEID=(\d+)/,
        account_id: /accountId[=:](\d+)/,
        username: /username (\w+) signedIn (\d)/,
        character_name: /AccountLoginCharacterStatus_Character.*name (\w+)\s*-\s*state STATE_CURRENT/,
        account_login_success: /\{SET_ACCOUNT_STATE\} state \[kAccountLoginSuccess\]/,

        // === SYSTEM INFO ===
        gpu_info: /GPU: Vendor = (\w+)/,
        gpu_detail: /Logging video adapters[\s\S]*?- (\w[\w\s]+?) \(vendor/,
        gpu_vram: /GPU: DedicatedVidMemMB = (\d+)/,
        cpu_info: /Host CPU: (.+)/,
        ram_info: /(\d+)MB physical memory installed/,
        game_version: /Branch: (.+)/,
        build_id: /Changelist: (\d+)/,
        resolution: /Current display mode is (\d+x\d+)/,

        // === SERVER & ENVIRONMENT ===
        server_env: /\[Trace\] Environment:\s+(\w+)/,
        server_session: /@session:\s+'([^']+)'/,
        server_region: /grpc-client-endpoint-override='https:\/\/(\w+)-/,

        // === CONNECTION & NETWORK ===
        connection_state: /\{SET_CONNECTION_STATE\} state \[(\w+)\]/,
        server_connect: /CSessionManager::OnClientConnected/,
        server_disconnect: /CSessionManager::RequestFrontEnd.*Started/,
        game_disconnect: /\[disconnectlight\]/,
        network_hostname: /network hostname: (.+)/,
        network_ip: /ip:(\d+\.\d+\.\d+\.\d+)/,

        // === LOCATION & NAVIGATION ===
        location: /Global location: <(.*?)>/,
        location_obj: /objectcontainers\/pu\/loc\/(?:flagship|mod)\/([^\/]+)\/([^\/]+)\//,
        loading_level: /Loading level (\w+)/,
        loading_screen: /CGlobalGameUI::OpenLoadingScreen/,
        loading_game_mode: /Loading GameModeRecord='(\w+)'/,

        // === QUANTUM DRIVE ===
        quantum_enter: /Quantum Travel: Entering/i,
        quantum_exit: /Quantum Travel: Exiting/i,

        // === ZONES ===
        armistice_enter: /SHUDEvent_OnNotification.*Entering Armistice Zone/i,
        armistice_leave: /SHUDEvent_OnNotification.*Leaving Armistice Zone/i,
        monitored_enter: /SHUDEvent_OnNotification.*Entered Monitored Space/i,

        // === PLAYER STATUS ===
        suffocating: /Player.*started suffocating/i,
        depressurizing: /Player.*started depressurization/i,
        die: /Actor Death/i,

        // === SHIPS & VEHICLES ===
        ship_control_release: /[Rr]eleas(?:ing|ed?) control token.*?(?:for|of)\s+['"]*([^'"<>\n]+)/i,
        ship_vehicle_spawn: /Vehicle\s+(?:Spawn|Spawned)[:\s]+(.+)/i,
        ship_starmap_fail: /GetStarMapNodeForEntity.*?'([^']+)'/,
        ship_enter_vehicle: /VehicleComponent.*?entering.*?(\w+_\w+)/i,

        // === INSURANCE ===
        insurance_claim: /[Ii]nsurance.*?[Cc]laim(?:ed|ing)?.*?([A-Z][a-z]+(?:_\w+)?)?/,

        // === DOCKING ===
        docking_request: /[Dd]ocking.*[Rr]equest(?:ed)?|[Rr]equest.*[Dd]ocking/,
        docking_granted: /[Dd]ocking.*[Gg]ranted|[Ll]anding.*[Pp]ad.*[Aa]ssigned/,

        // === INVENTORY ===
        inventory_open: /[Oo]pening\s+[Ii]nventory|[Ii]nventory.*[Oo]pen(?:ed)?/,
        inventory_close: /[Rr]elinquish(?:ing|ed)?\s+[Ii]nventory|[Ii]nventory.*[Cc]lose/,

        // === MEDICAL & SPAWN ===
        medical_bed: /[Mm]edical\s*[Bb]ed|[Mm]edBed|[Rr]egeneration\s*[Pp]od/,
        imprint_transplant: /[Tt]ransplant.*[Ii]mprint|[Ss]et.*[Ss]pawn(?:ing)?\s*(?:[Pp]oint|[Ll]ocation)?.*?(?:at|to|:)\s*(.+)/i,
        spawn_location: /[Rr]esolve[Ss]pawn[Ll]ocation.*?(?:zone|location).*?(\w+)/i,

        // === INVENTORY / EQUIPMENT ===
        attachment: /AttachmentReceived.*Player\[(\w+)\].*Attachment\[([^\]]+)\].*Port\[(\w+)\]/,

    // === VEHICLES & SHIPS ===
    vehicle_spawn: /Vehicle Spawned: (.*?) - (.*?)/,

        // === HARDWARE ===
        joystick: /Connected joystick\d+:\s+(.+?)\s*\{/,

            // === MISSIONS / CONTRACTS ===
            contract_gen: /CContractGenerator.*seed (\d+)/,
                mission_accepted: /[Mm]ission.*[Aa]ccept|[Cc]ontract.*[Aa]ccept/i,
                    mission_completed: /[Mm]ission.*[Cc]omplet|[Cc]ontract.*[Cc]omplet/i,
                        mission_failed: /[Mm]ission.*[Ff]ail|[Cc]ontract.*[Ff]ail/i,

                            // === SOCIAL / PARTY ===
                            group_update: /Update group cache.*(Success|Start)/,
                                social_subscribe: /SubscribeToPlayerSocial.*player (\d+)/,
                                    friend_subscribe: /SubscribeToFriendMessages.*player (\d+)/,
                                        party_invite: /NotifyPendingInvitations/,

                                            // === ENTITLEMENTS ===
                                            entitlement_count: /Started processing (\d+) entitlements/,
                                                // v2.2 Patterns
                                                mission_objective: /^New Objective: (.*?) \[\d+\]/,
                                                    contract_available: /^Contract Available: (.*?) \[\d+\]/,
                                                        location_planet: /planet cells:.*?name: (OOC_.*)/,
                                                            hangar_request: /local equip request/,
                                                                mission_marker: /Creating objective marker:.*?missionId/,
                                                                    ship_exit_confirm: /You have left the channel/,
                                                                        hazard_fire: /Fire Area .* received a snapshot/,
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

processLine(line, initialRead = false) {
    if (!line || !line.trim()) return false;
    let matched = false;

    // === PLAYER IDENTITY (only emit once during initial read) ===
    const legacyLogin = line.match(this.patterns.legacy_login);
    if (legacyLogin) {
        this.emit('gamestate', { type: 'PLAYER_NAME', value: legacyLogin[1] });
        this.emit('login', { status: 'connected', handle: legacyLogin[1] });
        return true;
    }

    const usernameMatch = line.match(this.patterns.username);
    if (usernameMatch) {
        this.emit('gamestate', { type: 'USERNAME', value: usernameMatch[1] });
        return true;
    }

    // Character name from login sequence
    const charMatch = line.match(this.patterns.character_name);
    if (charMatch) {
        this.emit('gamestate', { type: 'CHARACTER_NAME', value: charMatch[1] });
        return true;
    }

    // === SERVER / ENVIRONMENT ===
    const envMatch = line.match(this.patterns.server_env);
    if (envMatch) {
        this.currentServer = envMatch[1];
        this.emit('gamestate', { type: 'SERVER_ENV', value: envMatch[1] });
        return true;
    }

    const sessionMatch = line.match(this.patterns.server_session);
    if (sessionMatch) {
        this.emit('gamestate', { type: 'SESSION_ID', value: sessionMatch[1] });
        return true;
    }

    const regionMatch = line.match(this.patterns.server_region);
    if (regionMatch) {
        this.emit('gamestate', { type: 'SERVER_REGION', value: regionMatch[1] });
        return true;
    }

    // === SYSTEM INFO (emit during initial read only) ===
    if (initialRead) {
        const gpuMatch = line.match(this.patterns.gpu_info);
        if (gpuMatch) { this.emit('gamestate', { type: 'SYSTEM_GPU', value: gpuMatch[1] }); return true; }

        const vramMatch = line.match(this.patterns.gpu_vram);
        if (vramMatch) { this.emit('gamestate', { type: 'SYSTEM_VRAM', value: `${vramMatch[1]}MB` }); return true; }

        const cpuMatch = line.match(this.patterns.cpu_info);
        if (cpuMatch) { this.emit('gamestate', { type: 'SYSTEM_CPU', value: cpuMatch[1].trim() }); return true; }

        const ramMatch = line.match(this.patterns.ram_info);
        if (ramMatch) { this.emit('gamestate', { type: 'SYSTEM_RAM', value: `${ramMatch[1]}MB` }); return true; }

        const versionMatch = line.match(this.patterns.game_version);
        if (versionMatch) { this.emit('gamestate', { type: 'GAME_VERSION', value: versionMatch[1].trim() }); return true; }

        const buildMatch = line.match(this.patterns.build_id);
        if (buildMatch) { this.emit('gamestate', { type: 'BUILD_ID', value: buildMatch[1] }); return true; }

        const resMatch = line.match(this.patterns.resolution);
        if (resMatch) { this.emit('gamestate', { type: 'RESOLUTION', value: resMatch[1] }); return true; }

        const joystickMatch = line.match(this.patterns.joystick);
        if (joystickMatch) { this.emit('gamestate', { type: 'JOYSTICK', value: joystickMatch[1].trim() }); return true; }
    }

    // === CONNECTION STATE ===
    const connMatch = line.match(this.patterns.connection_state);
    if (connMatch) {
        this.emit('gamestate', { type: 'CONNECTION', value: connMatch[1] });
        matched = true;
    }

    if (this.patterns.server_connect.test(line)) {
        this.emit('gamestate', { type: 'CONNECTION', value: 'IN_GAME' });
        this.emit('gamestate', { type: 'GAME_JOIN', value: 'joined' });
        matched = true;
    }

    // Game disconnect / leave
    if (this.patterns.server_disconnect.test(line)) {
        this.emit('gamestate', { type: 'GAME_LEAVE', value: 'disconnected' });
        matched = true;
    }

    // === LOADING ===
    if (this.patterns.loading_screen.test(line)) {
        this.emit('gamestate', { type: 'LOADING', value: 'started' });
        matched = true;
    }

    const gameModeMatch = line.match(this.patterns.loading_game_mode);
    if (gameModeMatch) {
        this.emit('gamestate', { type: 'GAME_MODE', value: gameModeMatch[1] });
        matched = true;
    }

    // === LOCATION (Global) ===
    const locMatch = line.match(this.patterns.location);
    if (locMatch) {
        this.emit('gamestate', { type: 'LOCATION', value: locMatch[1].trim() });
        return true;
    }

    // === QUANTUM ===
    if (this.patterns.quantum_enter.test(line)) {
        this.emit('gamestate', { type: 'QUANTUM', value: 'entered' });
        matched = true;
    } else if (this.patterns.quantum_exit.test(line)) {
        this.emit('gamestate', { type: 'QUANTUM', value: 'exited' });
        matched = true;
    }

    // === ZONE STATE ===
    if (this.patterns.armistice_enter.test(line)) {
        this.emit('gamestate', { type: 'ZONE', value: 'armistice_enter' });
        matched = true;
    } else if (this.patterns.armistice_leave.test(line)) {
        this.emit('gamestate', { type: 'ZONE', value: 'armistice_leave' });
        matched = true;
    } else if (this.patterns.monitored_enter.test(line)) {
        this.emit('gamestate', { type: 'ZONE', value: 'monitored_enter' });
        matched = true;
    }

    // === PLAYER STATUS ===
    if (this.patterns.suffocating.test(line)) {
        if (!this.shouldSuppressAlert('suffocating')) {
            this.emit('gamestate', { type: 'STATUS', value: 'suffocating' });
        }
        matched = true;
    } else if (this.patterns.depressurizing.test(line)) {
        if (!this.shouldSuppressAlert('depressurizing')) {
            this.emit('gamestate', { type: 'STATUS', value: 'depressurizing' });
        }
        matched = true;
    } else if (this.patterns.die.test(line)) {
        this.emit('gamestate', { type: 'STATUS', value: 'death' });
        matched = true;
    }

    // === SHIPS & VEHICLES ===
    const shipReleaseMatch = line.match(this.patterns.ship_control_release);
    if (shipReleaseMatch) {
        const shipName = shipReleaseMatch[1].trim();
        this.currentShip = null;
        this.emit('gamestate', { type: 'SHIP_EXIT', value: shipName });
        matched = true;
    }

    const shipStarmapMatch = line.match(this.patterns.ship_starmap_fail);
    if (shipStarmapMatch) {
        const shipName = shipStarmapMatch[1].trim();
        this.currentShip = shipName;

        // v2.2 - Dynamic Ship Image
        const payload = { type: 'SHIP_ENTER', value: shipName };
        // Check exact match or partial match
        if (this.shipMap[shipName]) {
            payload.image = this.shipMap[shipName];
        } else {
            // Try fuzzy match (e.g. log says "DRAK_Clipper" but map has "Clipper")
            const key = Object.keys(this.shipMap).find(k => shipName.includes(k));
            if (key) payload.image = this.shipMap[key];
        }

        this.emit('gamestate', payload);
        matched = true;
    }

    const vehicleSpawnMatch = line.match(this.patterns.ship_vehicle_spawn);
    if (vehicleSpawnMatch && !matched) {
        this.emit('gamestate', { type: 'VEHICLE_SPAWN', value: vehicleSpawnMatch[1].trim() });
        matched = true;
    }

    // === INSURANCE ===
    if (this.patterns.insurance_claim.test(line)) {
        this.emit('gamestate', { type: 'INSURANCE_CLAIM', value: line.replace(/<[^>]+>\s*/, '').trim().substring(0, 120) });
        matched = true;
    }

    // === DOCKING ===
    if (this.patterns.docking_request.test(line)) {
        this.emit('gamestate', { type: 'DOCKING', value: 'requested' });
        matched = true;
    } else if (this.patterns.docking_granted.test(line)) {
        this.emit('gamestate', { type: 'DOCKING', value: 'granted' });
        matched = true;
    }

    // === INVENTORY ===
    if (this.patterns.inventory_open.test(line)) {
        this.emit('gamestate', { type: 'INVENTORY', value: 'opened' });
        matched = true;
    } else if (this.patterns.inventory_close.test(line)) {
        this.emit('gamestate', { type: 'INVENTORY', value: 'closed' });
        matched = true;
    }

    // === MEDICAL & SPAWN ===
    if (this.patterns.medical_bed.test(line)) {
        this.emit('gamestate', { type: 'MEDICAL_BED', value: 'entered' });
        matched = true;
    }

    const imprintMatch = line.match(this.patterns.imprint_transplant);
    if (imprintMatch) {
        const loc = imprintMatch[1] ? imprintMatch[1].trim() : 'Unknown';
        this.spawnPoint = loc;
        this.emit('gamestate', { type: 'SPAWN_SET', value: loc });
        matched = true;
    }

    const spawnMatch = line.match(this.patterns.spawn_location);
    if (spawnMatch && !this.spawnPoint) {
        this.spawnPoint = spawnMatch[1];
        this.emit('gamestate', { type: 'SPAWN_POINT', value: spawnMatch[1] });
        matched = true;
    }

    // === INVENTORY / EQUIPMENT ===
    const attachMatch = line.match(this.patterns.attachment);
    if (attachMatch) {
        this.emit('gamestate', {
            type: 'EQUIPMENT',
            value: { player: attachMatch[1], item: attachMatch[2], port: attachMatch[3] }
        });
        matched = true;
    }

    // === LOGIN SUCCESS ===
    if (this.patterns.login_success.test(line)) {
        this.emit('login', { status: 'connected' });
        matched = true;
    }

    if (this.patterns.account_login_success.test(line)) {
        this.emit('gamestate', { type: 'ACCOUNT_LOGIN', value: 'success' });
        matched = true;
    }

    // === MISSIONS ===
    if (this.patterns.mission_accepted.test(line)) {
        this.emit('gamestate', { type: 'MISSION', value: 'accepted', detail: line.replace(/<[^>]+>\s*/, '').trim().substring(0, 120) });
        matched = true;
    } else if (this.patterns.mission_completed.test(line)) {
        this.emit('gamestate', { type: 'MISSION', value: 'completed', detail: line.replace(/<[^>]+>\s*/, '').trim().substring(0, 120) });
        matched = true;
    } else if (this.patterns.mission_failed.test(line)) {
        this.emit('gamestate', { type: 'MISSION', value: 'failed', detail: line.replace(/<[^>]+>\s*/, '').trim().substring(0, 120) });
        matched = true;
    }

    // === PARTY INVITES ===
    if (this.patterns.party_invite.test(line)) {
        this.emit('gamestate', { type: 'PARTY_INVITE', value: 'pending' });
        matched = true;
    }

    // v2.2 - Mission Objective
    const missionObjMatch = line.match(this.patterns.mission_objective);
    if (missionObjMatch) {
        this.emit('gamestate', { type: 'MISSION_OBJECTIVE', value: missionObjMatch[1].trim() });
        matched = true;
    }

    // v2.2 - Contract Available
    const contractMatch = line.match(this.patterns.contract_available);
    if (contractMatch) {
        this.emit('gamestate', { type: 'CONTRACT_AVAILABLE', value: contractMatch[1].trim() });
        matched = true;
    }

    // v2.2 - Location (Planet/Moon detail)
    const planetMatch = line.match(this.patterns.location_planet);
    if (planetMatch) {
        // OOC_Stanton_1b_Aberdeen -> Aberdeen
        let loc = planetMatch[1].replace(/^OOC_/, '').replace(/Stanton_\d+[a-z]?_/, '');
        this.emit('gamestate', { type: 'LOCATION_PLANET', value: loc });
        // Also emit generic location to update main HUD
        this.emit('gamestate', { type: 'LOCATION', value: loc });
        matched = true;
    }

    // v2.2 - Hangar Request
    if (this.patterns.hangar_request.test(line)) {
        this.emit('gamestate', { type: 'HANGAR_REQUEST', value: 'Landing Services' });
        matched = true;
    }

    // v2.2 - Mission Marker
    if (this.patterns.mission_marker.test(line)) {
        this.emit('gamestate', { type: 'MISSION_MARKER', value: 'New Waypoint' });
        matched = true;
    }

    // v2.2 - Ship Exit Confirmation
    if (this.patterns.ship_exit_confirm.test(line)) {
        if (this.currentShip) {
            this.emit('gamestate', { type: 'SHIP_EXIT', value: this.currentShip });
            this.currentShip = null;
        } else {
            this.emit('gamestate', { type: 'SHIP_EXIT', value: 'Unknown Ship' });
        }
        matched = true;
    }

    // v2.2 - Fire Hazard
    if (this.patterns.hazard_fire.test(line)) {
        if (!this.shouldSuppressAlert('fire')) {
            this.emit('gamestate', { type: 'HAZARD_FIRE', value: 'Critical Fire' });
            this.setAlertCooldown('fire', 10000); // 10s cooldown
        }
        matched = true;
    }

    // === LOCATION HINT (Object Containers) - deduplicated ===
    const objMatch = line.match(this.patterns.location_obj);
    if (objMatch) {
        const system = objMatch[1];
        const location = objMatch[2];
        const key = `${system}/${location}`;

        if (initialRead) {
            if (!this.seenLocations.has(key)) {
                this.seenLocations.add(key);
                this.emit('gamestate', { type: 'LOCATION_HINT', value: key });
                matched = true;
            }
        } else {
            if (key !== this.lastLocationHint) {
                this.lastLocationHint = key;
                this.emit('gamestate', { type: 'LOCATION_HINT', value: key });
                matched = true;
            }
        }
    }

    // v2.2 - Check Custom Patterns (Manual Config)
    if (this.compiledCustomPatterns && this.compiledCustomPatterns.length > 0) {
        for (const p of this.compiledCustomPatterns) {
            const match = line.match(p.compiled);
            if (match) {
                // Extract value if capture group exists, else use full match
                const val = match[1] || match[0];
                this.emit('gamestate', {
                    type: 'CUSTOM',
                    level: p.level || 'INFO',
                    message: p.message || 'Custom Alert',
                    value: val
                });
                this.emit('custom-match', { patternId: p.id, match: val });
                matched = true;
                // Don't return, allow other processors? Or return?
                // Let's allow others, but mark matched so we don't treat as unknown.
            }
        }
    }

    if (matched) return true;

    // === UNKNOWN DISCOVERY ===
    if (!this.captureUnknowns) return false;

    // Clean up the line for grouping
    let cleaned = line
        .replace(/<[^>]+>/g, '') // Remove XML tags
        .replace(/^<\d{4}-\d{2}-\d{2}T[\d:.]+Z>\s*/, '') // Strip timestamp prefix
        .replace(/^\[(Notice|Error|Trace|Warning|Info)\]\s*/, '') // Strip severity prefix
        .trim();

    // Skip noise
    for (const noise of this.noisePatterns) {
        if (noise.test(cleaned)) return false;
    }

    // Skip very short lines
    if (cleaned.length < 15) return false;

    // If it's an initial read, don't capture unknowns
    if (initialRead) return false;

    this.captureUnknownLine(cleaned);
    return false; // Unknown lines don't count as "matched" for the main loop
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

    // Emit periodically (every 50 new unknowns)
    const total = Array.from(this.unknownGroups.values()).reduce((s, g) => s + g.count, 0);
    if (total % 50 === 0) {
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
