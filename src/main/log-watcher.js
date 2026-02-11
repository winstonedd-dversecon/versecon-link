const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const LogEngine = require('./parsers');

class LogWatcher extends EventEmitter {
    constructor() {
        super();
        this.watcher = null;
        this.filePath = null;
        this.isWatching = false;
        this.lastSize = 0;

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

        // Bind LogEngine events to this emitter
        LogEngine.on('gamestate', (data) => this.emit('gamestate', data));
        LogEngine.on('login', (data) => this.emit('login', data));

        // Legacy support (some UI components might expect these)
        this.patterns = {};
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
