const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const LogEngine = require('./parsers');
const vehicleParser = require('./parsers/vehicle');
const customParser = require('./parsers/custom');

class LogWatcher extends EventEmitter {
    static DEFAULT_PATTERNS = {
        geid: /geid\s+(\d+)/i,
        player_name: /name\s+([A-Za-z0-9_]+)/i,
        location: /Location\[([^\]]+)\]/i,
        server_env: /\[Trace\] Environment:\s+(\w+)/,
        quantum_entered: /<Jump Drive Requesting State Change>.*to Traveling/,
        quantum_exited: /<Jump Drive Requesting State Change>.*to Idle/,
        quantum_arrived: /<Quantum Drive Arrived/,
        actor_death: /<Actor Death>/,
        vehicle_control: /<Vehicle Control Flow>/,
    };

    constructor() {

        super();
        this.watcher = null;
        this.filePath = null;
        this.isWatching = false;
        this.lastSize = 0;

        // Alert cooldowns
        this.alertCooldowns = {};

        // Unknown log discovery state
        this.unknownGroups = new Map();
        this.unknownIgnored = new Set();
        this.captureUnknowns = true;

        // Noise patterns (unchanged from v2.2)
        this.noisePatterns = [
            /^\s*$/, /CryAnimation/i, /CEntityComponentPhysics/i, /SEntityPhysics/i,
            /CParticleEffect/i, /CFlowGraph/i, /CryAction/i, /pak_cache/i,
            /^\s*\d+\.\d+\s*$/, /PSOCacheGen/i, /VK_LAYER_/, /\[VK_INFO\]/,
            /\[VK\] Available Vulkan/, /grpc\.\w+=/, /RegisterUniverseHierarchy/,
            /ContextEstablisher/, /CVARS.*Not Whitelisted/, /Subsumption/,
            /CIG\s*$/, /^\s*-\s+Adapter/, /grpc\./, /===== PSOs Skipped/,
            /SysSpec mismatch/, /Shader not found/, /Technique not found/,
            /Unsupported PSO/, /RegisterOCHierarchyData/, /WaitForOCHierarchyData/,
            /CacheSolarSystemStreaming/, /BindSolarSystem/, /Entity Bury Request/,
            /DestroyEntity.*Aggregate/, /Failed to attach to itemport/
        ];

        // Legacy support (some UI components might expect these)
        this.patterns = {};

        // State Cache (for emitCurrentState)
        this.cachedState = {
            ship: null,
            server: null,
            spawn: null,
            session: null
        };

        // Bind LogEngine events to this emitter
        LogEngine.on('gamestate', (data) => {
            // Cache critical state
            if (data.type === 'SHIP_ENTER') this.cachedState.ship = data.value;
            // if (data.type === 'SHIP_EXIT') this.cachedState.ship = null; // Optional: keep last known?
            if (data.type === 'SERVER_ENV') this.cachedState.server = data.value;
            if (data.type === 'SESSION_ID') this.cachedState.session = data.value;
            if (data.type === 'SPAWN_SET') this.cachedState.spawn = data.value;

            // Check alert cooldowns if applicable
            if (data.type === 'STATUS' || data.type === 'HAZARD_FIRE') {
                if (this.shouldSuppressAlert(data.value || 'fire')) return;
            }
            this.emit('gamestate', data);
        });
        LogEngine.on('login', (data) => this.emit('login', data));
    }

    // --- State Management ---

    emitCurrentState() {
        if (this.cachedState.ship) this.emit('gamestate', { type: 'SHIP_CURRENT', value: this.cachedState.ship });
        if (this.cachedState.server) this.emit('gamestate', { type: 'SERVER_ENV', value: this.cachedState.server });
        if (this.cachedState.spawn) this.emit('gamestate', { type: 'SPAWN_POINT', value: this.cachedState.spawn });
        if (this.cachedState.session) this.emit('gamestate', { type: 'SESSION_ID', value: this.cachedState.session });
    }

    // --- Configuration Methods (called by main.js) ---

    setShipMap(map) {
        vehicleParser.setShipMap(map);
    }

    setCustomPatterns(patterns) {
        customParser.setPatterns(patterns);
    }

    setPatternOverrides(overrides) {
        // TODO: Implement overrides for specific built-in patterns if needed
        // For now, no-op to prevent crash
        console.log('[LogWatcher] Pattern overrides not yet supported in modular parser');
    }

    setAlertCooldown(alertType, cooldownMs) {
        this.alertCooldowns[alertType] = { cooldownMs, lastFired: 0 };
    }

    shouldSuppressAlert(alertType) {
        const cd = this.alertCooldowns[alertType];
        if (!cd || cd.cooldownMs <= 0) return false;
        const now = Date.now();
        if (now - cd.lastFired < cd.cooldownMs) return true;
        cd.lastFired = now;
        return false;
    }


    findLogFile() {
        const candidates = [];
        // Windows paths
        const drivers = ['C:', 'D:', 'E:', 'F:'];
        const winPaths = [
            'Program Files/Roberts Space Industries/StarCitizen/LIVE/Game.log',
            'Program Files/Roberts Space Industries/StarCitizen/PTU/Game.log',
            'Program Files/Roberts Space Industries/Star Citizen/LIVE/Game.log',
            'StarCitizen/LIVE/Game.log',
        ];
        for (const drive of drivers) {
            for (const p of winPaths) candidates.push(path.join(drive, p));
        }

        // Linux/Mac paths
        const home = process.env.HOME || process.env.USERPROFILE || '';
        if (home) {
            candidates.push(
                path.join(home, '.wine/drive_c/Program Files/Roberts Space Industries/Star Citizen/LIVE/Game.log'),
                path.join(home, 'Games/star-citizen/drive_c/Program Files/Roberts Space Industries/Star Citizen/LIVE/Game.log'),
                path.join(home, '.local/share/lutris/runners/wine/star-citizen/Game.log')
            );
        }

        // Dev Fallback
        candidates.push(path.join(__dirname, '..', 'Game.log'));

        for (const fullPath of candidates) {
            if (fs.existsSync(fullPath)) return fullPath;
        }
        return null;
    }

    readLastLines(filePath, maxLines = 10000) {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            return content.split('\n').slice(-maxLines);
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

        // Initial Scan
        const lines = this.readLastLines(this.filePath, 5000);
        lines.forEach(line => this.processLine(line, true));

        // Watch for updates
        try {
            let stat = fs.statSync(this.filePath);
            this.lastSize = stat.size;

            fs.watchFile(this.filePath, { interval: 1000 }, (curr, prev) => {
                if (curr.size > this.lastSize) {
                    const stream = fs.createReadStream(this.filePath, {
                        start: this.lastSize,
                        end: curr.size - 1,
                        encoding: 'utf-8'
                    });
                    let buffer = '';
                    stream.on('data', (chunk) => { buffer += chunk; });
                    stream.on('end', () => {
                        buffer.split('\n').forEach(line => {
                            if (line.trim()) this.processLine(line, false);
                        });
                    });
                    this.lastSize = curr.size;
                } else if (curr.size < this.lastSize) {
                    this.lastSize = curr.size;
                    this.emit('gamestate', { type: 'GAME_RESTART', value: 'restarted' });
                }
            });
            this.isWatching = true;
        } catch (e) {
            this.emit('error', `Failed to watch file: ${e.message}`);
        }
    }

    stop() {
        if (this.filePath) fs.unwatchFile(this.filePath);
        this.isWatching = false;
        this.emit('status', { connected: false });
    }

    processLine(line, initialRead = false) {
        if (!line || !line.trim()) return false;

        // 1. Noise Filter
        if (this.noisePatterns.some(p => p.test(line))) return false;

        // 2. Emit Raw Line (for Feed/Debug)
        this.emit('raw-line', line);

        // 3. Delegate to Modular Parsers
        // LogEngine handles forwarding events to us via the constructor listener
        const handled = LogEngine.process(line, { initialRead });
        if (handled) return true;

        // 4. Unknown Log Discovery (Fallback)
        if (this.captureUnknowns && !initialRead) {
            this.captureUnknownLine(line);
        }

        return false;
    }

    // --- Unknown Log Logic ---

    captureUnknownLine(line) {
        let cleaned = line.replace(/<[^>]+>/g, '')
            .replace(/^<\d{4}-\d{2}-\d{2}T[\d:.]+Z>\s*/, '')
            .replace(/^\[(Notice|Error|Trace|Warning|Info)\]\s*/, '')
            .trim();

        if (cleaned.length < 15) return;

        // Extract Key (simplified)
        let key = cleaned.substring(0, 60);
        const match = cleaned.match(/^<([^>]+)>/) || cleaned.match(/^(C?[A-Z][A-Za-z0-9]+(?:::[A-Za-z0-9_]+)?)/);
        if (match) key = match[1];

        if (this.unknownIgnored.has(key)) return;

        // Update Group
        if (!this.unknownGroups.has(key)) {
            if (this.unknownGroups.size >= 200) this.unknownGroups.delete(this.unknownGroups.keys().next().value); // Cap size
            this.unknownGroups.set(key, { sample: cleaned, count: 0, firstSeen: new Date().toISOString() });
        }

        const group = this.unknownGroups.get(key);
        group.count++;
        group.lastSeen = new Date().toISOString();

        // Emit batch
        if (group.count % 10 === 0) this.emitUnknowns();
    }

    emitUnknowns() {
        // Safe check for map existence
        if (!this.unknownGroups) return;
        const groups = Array.from(this.unknownGroups.values()).sort((a, b) => b.count - a.count);
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
