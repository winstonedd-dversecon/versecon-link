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
        // Default error listener to avoid unhandled 'error' events when no external
        // consumer has attached an error handler. It will log so callers can still
        // be informed via stdout/stderr.
        this.on('error', (err) => {
            console.error('[LogWatcher] error event:', err);
        });
        this.watcher = null;
        this.filePath = null;
        this.isWatching = false;
        this.lastSize = 0;

        // Attachment tracking for live overlays
        this.attachments = []; // array of { timestamp, attachmentId, archetype, numericId, port, raw }
        this.attachmentsByPort = new Map();

        // Alert cooldowns
        this.alertCooldowns = {};

        // Unknown log discovery state
        this.unknownGroups = new Map();
        this.unknownIgnored = new Set();
        this.captureUnknowns = true;
        this.initialScanLimit = 5000;

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
            session: null,
            startTime: null,
            build: null,
            location: null,
            jurisdiction: null,
            zone: null,
            shard: null
        };

        // Bind LogEngine events to this emitter
        LogEngine.on('gamestate', (data) => {
            // Cache critical state
            if (data.type === 'SHIP_ENTER') this.cachedState.ship = data.value;
            if (data.type === 'SHIP_EXIT') this.cachedState.ship = null;
            if (data.type === 'SERVER_ENV') this.cachedState.server = data.value;
            if (data.type === 'SERVER_CONNECTED') this.cachedState.shard = data.value;
            if (data.type === 'SESSION_ID') this.cachedState.session = data.value;
            if (data.type === 'SPAWN_SET') this.cachedState.spawn = data.value;
            if (data.type === 'SESSION_START') this.cachedState.startTime = data.value;
            if (data.type === 'BUILD_INFO') this.cachedState.build = data.value;
            if (data.type === 'LOCATION') this.cachedState.location = data.value;
            // Attachment events (from inventory parser)
            if (data.type === 'ATTACHMENT_RECEIVED' && data.value) {
                try {
                    this.updateAttachment(data.value);
                } catch (e) {
                    console.error('[LogWatcher] Failed to update attachment state:', e.message);
                }
            }
            if (data.type === 'JURISDICTION') this.cachedState.jurisdiction = data.value;
            if (data.type === 'ZONE') this.cachedState.zone = data.value;

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
        if (this.cachedState.shard) this.emit('gamestate', { type: 'SERVER_CONNECTED', value: this.cachedState.shard });
        if (this.cachedState.spawn) this.emit('gamestate', { type: 'SPAWN_SET', value: this.cachedState.spawn });
        if (this.cachedState.session) this.emit('gamestate', { type: 'SESSION_ID', value: this.cachedState.session });
        if (this.cachedState.startTime) this.emit('gamestate', { type: 'SESSION_START', value: this.cachedState.startTime });
        if (this.cachedState.build) this.emit('gamestate', { type: 'BUILD_INFO', value: this.cachedState.build });
        if (this.cachedState.location) this.emit('gamestate', { type: 'LOCATION', value: this.cachedState.location });
    }

    // --- Configuration Methods (called by main.js) ---

    setPath(customPath) {
        if (this.isWatching) this.stop();
        this.start(customPath);
    }

    setShipMap(map) {
        vehicleParser.setShipMap(map);
    }

    setCustomPatterns(patterns) {
        customParser.setPatterns(patterns);
    }

    setPatternOverrides(overrides) {
        if (!LogEngine || !LogEngine.parsers) {
            console.log('[LogWatcher] Cannot apply pattern overrides: LogEngine not loaded');
            return;
        }

        // Apply overrides to all registered parsers
        for (const parser of LogEngine.parsers) {
            if (parser.patterns) {
                for (const [key, _] of Object.entries(parser.patterns)) {
                    if (overrides[key]) {
                        const override = overrides[key];

                        // If it's disabled or deleted by the user, we replace the regex in memory
                        // with an unmatchable regex string so it never triggers.
                        if (override.deleted || override.disabled) {
                            parser.patterns[key] = /(?!)/;
                            continue;
                        }

                        // If the user provided a custom regex definition, apply it
                        if (override.regex) {
                            try {
                                parser.patterns[key] = new RegExp(override.regex, 'i');
                            } catch (e) {
                                console.error(`[LogWatcher] Invalid regex override for ${key}:`, e);
                            }
                        }
                    }
                }
            }
        }
        console.log('[LogWatcher] Applied built-in pattern overrides to modular parsers');
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
        // Allow explicit override from environment for automation/testing
        const envPath = process.env.GAME_LOG_PATH || process.env.LOG_PATH || null;
        if (envPath) candidates.push(envPath);
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
            // FIX 6: Additional Linux paths for native installs or common alternate locations
            candidates.push(
                path.join(home, 'Games/Star Citizen/Game.log'),
                path.join(home, 'Games/StarCitizen/Game.log'),
                path.join(home, '.star-citizen/Game.log'),
                path.join(home, '.starclient/Game.log'),
                '/opt/starcitizen/Game.log'
            );
        }

        // Dev Fallback
        candidates.push(path.join(__dirname, '..', 'Game.log'));
        // Also check workspace root (cwd) for convenience
        candidates.push(path.join(process.cwd(), 'Game.log'));

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
        console.log('[LogWatcher] START called with customPath:', customPath);
        console.log('[LogWatcher] Current isWatching:', this.isWatching);

        if (this.isWatching) {
            console.log(`[LogWatcher] Already watching: ${this.filePath}`);
            return;
        }

        this.filePath = customPath || this.findLogFile();
        console.log('[LogWatcher] Resolved filePath:', this.filePath);

        if (!this.filePath) {
            console.error('[LogWatcher] No Game.log found.');
            this.emit('status', { connected: false, message: 'Game.log not found. Set GAME_LOG_PATH or call setPath()' });
            return;
        }

        // Validate file existence and permissions
        try {
            fs.accessSync(this.filePath, fs.constants.R_OK);
            console.log(`[LogWatcher] File validated: ${this.filePath} (readable)`);
        } catch (e) {
            console.error(`[LogWatcher] Permission denied or file missing: ${this.filePath}`, e);
            this.emit('error', `Cannot read Log: ${e.message}`);
            this.emit('status', { connected: false });
            return;
        }

        console.log(`[LogWatcher] Starting watch on: ${this.filePath}`);
        this.emit('status', { connected: true, path: this.filePath });

        // Initial Scan (Async non-blocking)
        setTimeout(async () => {
            try {
                const content = await fs.promises.readFile(this.filePath, 'utf-8');
                const lines = content.split('\n').slice(-this.initialScanLimit);
                console.log(`[LogWatcher] Initial scan processing ${lines.length} lines asynchronously.`);

                // Process in batches of 500 to yield event loop
                const BATCH_SIZE = 500;
                for (let i = 0; i < lines.length; i += BATCH_SIZE) {
                    const batch = lines.slice(i, i + BATCH_SIZE);
                    batch.forEach(line => this.processLine(line, true));
                    await new Promise(resolve => setTimeout(resolve, 5)); // Yield to unblock UI
                }
                console.log(`[LogWatcher] Initial scan complete.`);
                this.emit('initial-scan-complete');
            } catch (e) {
                console.error('[LogWatcher] Initial scan failed:', e);
            }
        }, 100);

        // Watch for updates
        try {
            let stat = fs.statSync(this.filePath);
            this.lastSize = stat.size;
            console.log(`[LogWatcher] Initial file size: ${this.lastSize} bytes`);

            fs.watchFile(this.filePath, { interval: 100 }, (curr, prev) => {
                if (curr.size > this.lastSize) {
                    const stream = fs.createReadStream(this.filePath, {
                        start: this.lastSize,
                        end: curr.size - 1,
                        encoding: 'utf-8'
                    });
                    let buffer = '';
                    stream.on('data', (chunk) => { buffer += chunk; });
                    stream.on('end', () => {
                        this.tailBuffer = (this.tailBuffer || '') + buffer;
                        const lines = this.tailBuffer.split('\n');

                        // The last element might be an incomplete line. Save it for the next read event.
                        this.tailBuffer = lines.pop();

                        const completeLines = lines.filter(l => l.trim());
                        if (completeLines.length > 0) {
                            completeLines.forEach(line => this.processLine(line, false));
                        }
                    });
                    this.lastSize = curr.size;
                } else if (curr.size < this.lastSize) {
                    console.log(`[LogWatcher] File size decreased - game restarted`);
                    this.lastSize = curr.size;
                    this.emit('gamestate', { type: 'GAME_RESTART', value: 'restarted' });
                }
            });
            this.isWatching = true;
            console.log('[LogWatcher] File watcher initialized successfully');
        } catch (e) {
            console.error('[LogWatcher] Failed to initialize file watcher:', e);
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
        if (group.count === 1 || group.count % 10 === 0) this.emitUnknowns();
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

    // --- Attachment State Helpers ---

    updateAttachment(att) {
        if (!att || !att.port) return;
        const item = {
            timestamp: att.timestamp || new Date().toISOString(),
            attachmentId: att.attachmentId || `${att.archetype}_${att.numericId || ''}`,
            archetype: att.archetype || null,
            numericId: att.numericId || null,
            port: att.port,
            raw: att.raw || ''
        };

        // Update by port (latest wins)
        this.attachmentsByPort.set(item.port, item);

        // Rebuild attachments array sorted by port name for determinism
        this.attachments = Array.from(this.attachmentsByPort.values()).sort((a, b) => (a.port || '').localeCompare(b.port || ''));

        // Write atomic loadout file in repo root
        try {
            const out = { player: att.player || null, attachments: this.attachments };
            const outPath = path.join(__dirname, '..', 'loadout.json');
            const tmpPath = outPath + '.tmp';
            fs.writeFileSync(tmpPath, JSON.stringify(out, null, 2), 'utf8');
            fs.renameSync(tmpPath, outPath);
            this.emit('gamestate', { type: 'LOADOUT_UPDATED', value: out });
        } catch (e) {
            console.error('[LogWatcher] Failed to write loadout.json:', e.message);
        }
    }
}

const instance = new LogWatcher();

// FIX 2: Export findLogFile as a static method so it can be called on the module
instance.findLogFile = instance.findLogFile.bind(instance);

module.exports = instance;
module.exports.findLogFile = instance.findLogFile;
