const { EventEmitter } = require('events');
const crypto = require('crypto');
const NetworkWatcher = require('./network-watcher');
const NetworkTelemetry = require('./network-telemetry');
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

        this.telemetryHelper = null;
        this.telemetryInterval = null;

        this.init();
    }

    init() {
        // Wire up Network
        this.networkWatcher.on('connected', async (conn) => {
            if (this.session.remoteIp) {
                console.log('[TelemetryEngine] TCP Watcher connection ignored - direct server info active.');
                return;
            }
            this.session.remoteIp = conn.remoteIp;
            this.session.remotePort = conn.remotePort;
            this.generateShardSig();

            // Setup telemetry helper
            this.telemetryHelper = new NetworkTelemetry(conn.pid, conn.remoteIp);
            
            // Get GeoIP immediately (async)
            this.telemetryHelper.getGeoIP().then((geo) => {
                this.emit('telemetry', {
                    type: 'NETWORK_QUALITY',
                    data: {
                        ping: this.telemetryHelper.pingMs,
                        geo: geo,
                        bandwidth: { downMbps: 0, upMbps: 0 }
                    },
                    timestamp: Date.now()
                });
            });

            this.emit('telemetry', {
                type: 'SERVER_CONNECTED',
                data: { ip: conn.remoteIp, port: conn.remotePort },
                confidence: 1.0,
                timestamp: Date.now()
            });

            // Start polling ping and bandwidth every 3 seconds
            if (this.telemetryInterval) clearInterval(this.telemetryInterval);
            this.telemetryInterval = setInterval(async () => {
                if (this.telemetryHelper) {
                    const ping = await this.telemetryHelper.measurePing();
                    const bw = await this.telemetryHelper.measureBandwidth();
                    
                    this.emit('telemetry', {
                        type: 'NETWORK_QUALITY',
                        data: {
                            ping: ping,
                            geo: this.telemetryHelper.geoData,
                            bandwidth: bw
                        },
                        timestamp: Date.now()
                    });
                }
            }, 3000);
        });

        this.networkWatcher.on('disconnected', (conn) => {
            if (this.session.remoteIp && this.session.remoteIp !== conn.remoteIp) {
                console.log('[TelemetryEngine] TCP Watcher disconnect ignored - direct server info active.');
                return;
            }
            if (this.telemetryInterval) {
                clearInterval(this.telemetryInterval);
                this.telemetryInterval = null;
            }
            this.telemetryHelper = null;

            this.emit('telemetry', {
                type: 'SERVER_DISCONNECTED',
                confidence: 0.9,
                timestamp: Date.now()
            });
            this.session.remoteIp = null;
        });
    }

    updateServerInfo(serverInfo) {
        if (!serverInfo || !serverInfo.address) return;

        const remoteIp = serverInfo.address;
        const remotePort = serverInfo.port;
        const shard = serverInfo.shard;

        // Skip if same IP
        if (this.session.remoteIp === remoteIp) return;

        console.log(`[TelemetryEngine] Direct Server Info Update: ${remoteIp}:${remotePort} Shard: ${shard}`);

        this.session.remoteIp = remoteIp;
        this.session.remotePort = remotePort;
        if (shard) {
            this.session.id = shard;
        }
        this.generateShardSig();

        // Find PID of Star Citizen or fallback
        let pid = 0;
        if (this.networkWatcher && this.networkWatcher.scPid) {
            pid = this.networkWatcher.scPid;
        } else if (this.networkWatcher) {
            this.networkWatcher.findProcessId();
        }

        // Setup telemetry helper
        this.telemetryHelper = new NetworkTelemetry(pid, remoteIp);

        // Get GeoIP immediately (async)
        this.telemetryHelper.getGeoIP().then((geo) => {
            this.emit('telemetry', {
                type: 'NETWORK_QUALITY',
                data: {
                    ping: this.telemetryHelper.pingMs,
                    geo: geo,
                    bandwidth: { downMbps: 0, upMbps: 0 }
                },
                timestamp: Date.now()
            });
        });

        this.emit('telemetry', {
            type: 'SERVER_CONNECTED',
            data: { ip: remoteIp, port: remotePort },
            confidence: 1.0,
            timestamp: Date.now()
        });

        // Start polling ping and bandwidth every 3 seconds
        if (this.telemetryInterval) clearInterval(this.telemetryInterval);
        this.telemetryInterval = setInterval(async () => {
            if (this.telemetryHelper) {
                if (!this.telemetryHelper.pid && this.networkWatcher && this.networkWatcher.scPid) {
                    this.telemetryHelper.pid = this.networkWatcher.scPid;
                }
                const ping = await this.telemetryHelper.measurePing();
                const bw = await this.telemetryHelper.measureBandwidth();

                this.emit('telemetry', {
                    type: 'NETWORK_QUALITY',
                    data: {
                        ping: ping,
                        geo: this.telemetryHelper.geoData,
                        bandwidth: bw
                    },
                    timestamp: Date.now()
                });
            }
        }, 3000);
    }

    start() {
        this.networkWatcher.start();
    }

    stop() {
        if (this.telemetryInterval) {
            clearInterval(this.telemetryInterval);
            this.telemetryInterval = null;
        }
        this.networkWatcher.stop();
    }

    setLogPath(path) {
        // LogWatcher handles path changes, we just need to restart network watcher if needed
        if (this.telemetryInterval) {
            clearInterval(this.telemetryInterval);
            this.telemetryInterval = null;
        }
        this.networkWatcher.stop();
        this.session.remoteIp = null;
        this.networkWatcher.start();
    }

    handleLogLine(line) {
        // 1. Telemetry Extraction
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
