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

        // Unknown log discovery
        this.unknownGroups = new Map(); // key -> { sample, count, firstSeen, lastSeen }
        this.unknownIgnored = new Set(); // user-ignored patterns
        this.captureUnknowns = true;

        // Noise filter — skip extremely common/uninteresting CryEngine lines
        this.noisePatterns = [
            /^\s*$/,
            /^\[/,  // timestamp-only lines
            /CryAnimation/i,
            /CEntityComponentPhysics/i,
            /SEntityPhysics/i,
            /CParticleEffect/i,
            /CFlowGraph/i,
            /CryAction/i,
            /streaming/i,
            /^<\d{4}/,  // timestamp prefix lines
            /pak_cache/i,
            /CIG\s*$/,
            /^\s*\d+\.\d+/,  // bare numbers
        ];

        // Regex Patterns — sourced from real SC 4.6 Game.log analysis
        this.patterns = {
            // === LOGIN & IDENTITY ===
            login_success: /CDisciplineServiceExternal::OnLoginStatusChanged.*LoggedIn/,
            login_completed: /LoginCompleted.*message/,
            legacy_login: /Legacy login response.*Handle\[(\w+)\]/,  // RSI Handle
            player_geid: /playerGEID=(\d+)/,
            account_id: /accountId[=:](\d+)/,
            username: /username (\w+) signedIn (\d)/,
            character_name: /name (\w+) - state STATE_CURRENT/,

            // === SYSTEM INFO ===
            gpu_info: /GPU: Vendor = (\w+)/,
            cpu_info: /Host CPU: (.+)/,
            ram_info: /(\d+)MB physical memory installed/,
            game_version: /Branch: (.+)/,
            build_id: /Changelist: (\d+)/,
            resolution: /Current display mode is (\d+x\d+)/,

            // === CONNECTION & NETWORK ===
            connection_state: /\{SET_CONNECTION_STATE\} state \[(\w+)\]/,
            server_connect: /CSessionManager::OnClientConnected/,
            network_hostname: /network hostname: (.+)/,
            network_ip: /ip:(\d+\.\d+\.\d+\.\d+)/,

            // === LOCATION & NAVIGATION ===
            location: /Global location: <(.*?)>/,
            location_obj: /objectcontainers\/pu\/loc\/(?:flagship|mod)\/([^\/]+)\/([^\/]+)\//,
            loading_level: /Loading level (\w+)/,
            loading_screen: /CGlobalGameUI::OpenLoadingScreen/,

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

            // === INVENTORY / EQUIPMENT ===
            attachment: /AttachmentReceived.*Player\[(\w+)\].*Attachment\[([^\]]+)\].*Port\[(\w+)\]/,

            // === VEHICLES & SHIPS ===
            vehicle_spawn: /Vehicle Spawned: (.*?) - (.*?)/,

            // === HARDWARE ===
            joystick: /Connected joystick\d+:\s+(.+?)\s*\{/,

            // === MISSIONS / CONTRACTS ===
            contract_gen: /CContractGenerator.*seed (\d+)/,

            // === SOCIAL / PARTY ===
            group_update: /Update group cache.*(\w+)/,
            social_subscribe: /SubscribeToPlayerSocial.*player (\d+)/,
            friend_subscribe: /SubscribeToFriendMessages.*player (\d+)/,

            // === ENTITLEMENTS ===
            entitlement_count: /Started processing (\d+) entitlements/,
        };
    }

    findLogFile() {
        const candidates = [];

        // Windows paths — IMPORTANT: The folder is "StarCitizen" (no space) on most installs
        const drivers = ['C:', 'D:', 'E:', 'F:'];
        const winPaths = [
            // Standard RSI Launcher installs (NO space in StarCitizen)
            'Program Files/Roberts Space Industries/StarCitizen/LIVE/Game.log',
            'Program Files/Roberts Space Industries/StarCitizen/PTU/Game.log',
            'Program Files/Roberts Space Industries/StarCitizen/EPTU/Game.log',
            // Legacy / alternate installs (WITH space)
            'Program Files/Roberts Space Industries/Star Citizen/LIVE/Game.log',
            'Program Files/Roberts Space Industries/Star Citizen/PTU/Game.log',
            // Custom install locations
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
                }
            });

            this.isWatching = true;
            console.log('[LogWatcher] Now watching for new log entries...');
        } catch (e) {
            this.emit('error', `Failed to watch file: ${e.message}`);
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

        // === SYSTEM INFO (emit during initial read only) ===
        if (initialRead) {
            const gpuMatch = line.match(this.patterns.gpu_info);
            if (gpuMatch) { this.emit('gamestate', { type: 'SYSTEM_GPU', value: gpuMatch[1] }); return true; }

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
            matched = true;
        }

        // === LOADING ===
        if (this.patterns.loading_screen.test(line)) {
            this.emit('gamestate', { type: 'LOADING', value: 'started' });
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
            this.emit('gamestate', { type: 'STATUS', value: 'suffocating' });
            matched = true;
        } else if (this.patterns.depressurizing.test(line)) {
            this.emit('gamestate', { type: 'STATUS', value: 'depressurizing' });
            matched = true;
        } else if (this.patterns.die.test(line)) {
            this.emit('gamestate', { type: 'STATUS', value: 'death' });
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

        // === UNKNOWN LINE CAPTURE ===
        if (!matched && this.captureUnknowns && !initialRead) {
            this.captureUnknownLine(line);
        }

        return matched;
    }

    // Group unknown lines by their first significant keyword
    captureUnknownLine(line) {
        // Skip noise
        for (const noise of this.noisePatterns) {
            if (noise.test(line)) return;
        }

        // Skip very short lines
        if (line.trim().length < 20) return;

        // Extract group key: first class/function name or significant identifier
        const cleaned = line.replace(/^<[^>]+>\s*/, '').trim(); // Strip timestamp
        const keyMatch = cleaned.match(/^([A-Z][A-Za-z0-9_:]+)/); // CClassName::Method style
        const key = keyMatch ? keyMatch[1].substring(0, 50) : cleaned.substring(0, 40);

        // Check if ignored
        if (this.unknownIgnored.has(key)) return;

        const now = new Date().toISOString();
        if (this.unknownGroups.has(key)) {
            const group = this.unknownGroups.get(key);
            group.count++;
            group.lastSeen = now;
        } else {
            // Cap at 200 groups
            if (this.unknownGroups.size >= 200) {
                // Remove oldest
                const oldest = this.unknownGroups.keys().next().value;
                this.unknownGroups.delete(oldest);
            }
            this.unknownGroups.set(key, {
                group: key,
                sample: cleaned.substring(0, 200),
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
