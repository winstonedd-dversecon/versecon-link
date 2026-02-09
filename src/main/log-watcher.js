const fs = require('fs');
const path = require('path');
const { Tail } = require('tail'); // using 'tail' package for simplicity, or 'tail-stream'
const { EventEmitter } = require('events');

class LogWatcher extends EventEmitter {
    constructor() {
        super();
        this.tail = null;
        this.filePath = null;
        this.isWatching = false;

        // Regex Patterns
        this.patterns = {
            login: /Cloud Imperium Games Public Auth Service/i,
            location: /Global location: <(.*?)>/, // "Global location: < Stanton >"
            // location_precise: /Physics Grid: (.*?) /, // More precise if needed
            quantum_enter: /Quantum Travel: Entering/i,
            quantum_exit: /Quantum Travel: Exiting/i,
            // Combat
            vehicle_spawn: /Vehicle Spawned: (.*?) - (.*?)/, // Name, ID? (Depends on verbosity)
            die: /Actor Death/i
        };
    }

    findLogFile() {
        // Standard Locations
        const drivers = ['C:', 'D:', 'E:', 'F:'];
        const commonPaths = [
            'Program Files/Roberts Space Industries/Star Citizen/LIVE/Game.log',
            'Roberts Space Industries/Star Citizen/LIVE/Game.log',
            'StarCitizen/LIVE/Game.log'
        ];

        for (const drive of drivers) {
            for (const p of commonPaths) {
                const fullPath = path.join(drive, p);
                if (fs.existsSync(fullPath)) {
                    return fullPath;
                }
            }
        }
        return null;
    }

    start(customPath = null) {
        if (this.isWatching) return;

        this.filePath = customPath || this.findLogFile();

        if (!this.filePath) {
            this.emit('error', 'Game.log not found. Please locate it manually.');
            return;
        }

        console.log(`[LogWatcher] Tailing: ${this.filePath}`);
        this.emit('status', { connected: true, path: this.filePath });

        // Tail the file
        try {
            this.tail = new Tail(this.filePath, {
                useWatchFile: true, // Better for Windows often
                fsWatchOptions: { interval: 500 }
            });

            this.tail.on('line', (line) => this.processLine(line));
            this.tail.on('error', (err) => this.emit('error', err));
            this.tail.watch();
            this.isWatching = true;

        } catch (e) {
            this.emit('error', `Failed to watch file: ${e.message}`);
        }
    }

    stop() {
        if (this.tail) {
            this.tail.unwatch();
            this.tail = null;
        }
        this.isWatching = false;
        this.emit('status', { connected: false });
    }

    processLine(line) {
        // 1. Location
        const locMatch = line.match(this.patterns.location);
        if (locMatch) {
            this.emit('gamestate', { type: 'LOCATION', value: locMatch[1] });
            return;
        }

        // 2. Quantum
        if (this.patterns.quantum_enter.test(line)) {
            this.emit('gamestate', { type: 'QUANTUM', value: 'IN_TRAVEL' });
            return;
        }
        if (this.patterns.quantum_exit.test(line)) {
            this.emit('gamestate', { type: 'QUANTUM', value: 'EXIT' });
            return;
        }

        // 3. Login
        if (this.patterns.login.test(line)) {
            this.emit('gamestate', { type: 'LOGIN', value: 'ONLINE' });
        }
    }
}

module.exports = new LogWatcher();
