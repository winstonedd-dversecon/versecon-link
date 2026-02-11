const { exec } = require('child_process');
const { EventEmitter } = require('events');
const os = require('os');

class NetworkWatcher extends EventEmitter {
    constructor(intervalMs = 1000) {
        super();
        this.intervalMs = intervalMs;
        this.intervalId = null;
        this.platform = os.platform();
        this.scPid = null;
        this.lastConnection = null;
    }

    start() {
        if (this.intervalId) return;
        console.log('[NetworkWatcher] Starting TCP Monitoring...');
        this.intervalId = setInterval(() => this.poll(), this.intervalMs);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    setPid(pid) {
        this.scPid = pid;
    }

    async poll() {
        try {
            // If we don't know the PID, try to find it
            if (!this.scPid) {
                this.findProcessId();
                return;
            }

            const connections = await this.getTcpConnections();

            // Filter for Star Citizen game ports (typically 7000-8000 range for PU)
            // Or just any ESTABLISHED connection to a remote IP
            const active = connections.find(c =>
                c.pid === this.scPid &&
                c.state === 'ESTABLISHED' &&
                c.remotePort >= 7000 && c.remotePort <= 8000
            );

            if (active) {
                if (!this.lastConnection || this.lastConnection.remoteIp !== active.remoteIp) {
                    this.emit('connected', active);
                    console.log('[NetworkWatcher] Match:', active);
                }
                this.lastConnection = active;
            } else {
                if (this.lastConnection) {
                    this.emit('disconnected', this.lastConnection);
                    this.lastConnection = null;
                }
            }

        } catch (e) {
            // console.error('[NetworkWatcher] Poll Error:', e.message);
        }
    }

    findProcessId() {
        const cmd = this.platform === 'win32'
            ? 'tasklist /FI "IMAGENAME eq StarCitizen.exe" /FO CSV /NH'
            : 'pgrep -f "StarCitizen.exe"'; // Linux/Wine

        exec(cmd, (err, stdout) => {
            if (err || !stdout) return;

            if (this.platform === 'win32') {
                const parts = stdout.split(',');
                if (parts.length >= 2) {
                    const pid = parseInt(parts[1].replace(/"/g, ''));
                    if (!isNaN(pid)) {
                        this.scPid = pid;
                        console.log(`[NetworkWatcher] Found StarCitizen.exe PID: ${this.scPid}`);
                    }
                }
            } else {
                const pid = parseInt(stdout.trim());
                if (!isNaN(pid)) {
                    this.scPid = pid;
                    console.log(`[NetworkWatcher] Found StarCitizen PID: ${this.scPid}`);
                }
            }
        });
    }

    getTcpConnections() {
        return new Promise((resolve) => {
            if (this.platform === 'win32') {
                // Windows: netstat -ano -p tcp
                exec('netstat -ano -p tcp', (err, stdout) => {
                    if (err) return resolve([]);
                    const lines = stdout.split('\r\n');
                    const params = [];
                    lines.forEach(line => {
                        const parts = line.trim().split(/\s+/);
                        if (parts.length >= 5 && parts[0] === 'TCP') {
                            params.push({
                                localIp: parts[1].split(':')[0],
                                remoteIp: parts[2].split(':')[0],
                                remotePort: parseInt(parts[2].split(':').pop()),
                                state: parts[3],
                                pid: parseInt(parts[4])
                            });
                        }
                    });
                    resolve(params);
                });
            } else {
                // Linux: ss -tunp (requires sudo/caps usually, but we try /proc/net/tcp for non-privileged?)
                // Or simplified mock for dev environment
                // Note: /proc/net/tcp uses hex IPs/Ports
                exec('ss -tunp', (err, stdout) => {
                    if (err) return resolve([]);
                    // Simplified parsing for dev mock
                    resolve([]);
                });
            }
        });
    }
}

module.exports = NetworkWatcher;
