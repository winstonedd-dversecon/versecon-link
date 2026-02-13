const { EventEmitter } = require('events');
const crypto = require('crypto');
const NetworkWatcher = require('./network-watcher');
const LogEngine = require('../parsers'); // Reuse existing regex parsers

class TelemetryEngine extends EventEmitter {
    constructor() {
        super();
        this.networkWatcher = new NetworkWatcher(5000); // 5s network check - MUCH safer for system load

        this.session = {
            id: null,
            shardSig: null,
            remoteIp: null,
            remotePort: null
        };

        this.init();
    }

    init() {
        // Wire up Network
        this.networkWatcher.on('connected', (conn) => {
            this.session.remoteIp = conn.remoteIp;
            this.session.remotePort = conn.remotePort;
            this.generateShardSig();

            this.emit('telemetry', {
                type: 'SERVER_CONNECTED',
                data: { ip: conn.remoteIp, port: conn.remotePort },
                confidence: 1.0,
                timestamp: Date.now()
            });
        });

        this.networkWatcher.on('disconnected', (conn) => {
            this.emit('telemetry', {
                type: 'SERVER_DISCONNECTED',
                confidence: 0.9,
                timestamp: Date.now()
            });
            this.session.remoteIp = null;
        });
    }

    start() {
        this.networkWatcher.start();
    }

    stop() {
        this.networkWatcher.stop();
    }

    setLogPath(path) {
        // LogWatcher handles path changes, we just need to restart network watcher if needed
        this.networkWatcher.stop();
        this.session.remoteIp = null;
        this.networkWatcher.start();
    }

    handleLogLine(line) {
        // 1. Pass to Legacy Parsers (for existing Dashboard features)
        // LogEngine typically expects just the line, but might need modification
        // We can emit 'raw' for main.js to pick up if needed
        this.emit('raw', line);

        // 2. Telemetry Extraction
        // Check for Session ID
        // Pattern: "Global Session ID: [UUID]" or similar
        // (We need to confirm exact log pattern or use LogEngine's result)

        const handled = LogEngine.process(line, { initialRead: false });
        // NOTE: LogEngine emits global events. We need to catch them here or in main.js?
        // Ideally TelemetryEngine observes LogEngine's output too.
    }

    generateShardSig() {
        if (this.session.remoteIp && this.session.remotePort && this.session.id) {
            const raw = `${this.session.remoteIp}:${this.session.remotePort}-${this.session.id}`;
            this.session.shardSig = crypto.createHash('sha1').update(raw).digest('hex');

            this.emit('telemetry', {
                type: 'SHARD_CONFIRMED',
                shardSignature: this.session.shardSig,
                confidence: 1.0
            });
        }
    }

    // Called when LogEngine detects a Session ID
    updateSessionId(sid) {
        this.session.id = sid;
        this.generateShardSig();
        this.emit('telemetry', { type: 'SESSION_ID_CAPTURED', data: sid });
    }
}

module.exports = TelemetryEngine;
