const { exec } = require('child_process');
const axios = require('axios');

class NetworkTelemetry {
    constructor(pid, remoteIp) {
        this.pid = pid;
        this.remoteIp = remoteIp;
        this.lastReadBytes = null;
        this.lastWriteBytes = null;
        this.lastPollTime = null;
        this.geoData = null;
        this.pingMs = null;
        
        // Cache to avoid hitting API repeatedly for same IP
        this.locationCache = {};
    }

    async getGeoIP() {
        if (!this.remoteIp) return null;
        if (this.locationCache[this.remoteIp]) {
            return this.locationCache[this.remoteIp];
        }

        try {
            // Use ip-api.com (free, no key required)
            const response = await axios.get(`http://ip-api.com/json/${this.remoteIp}`, { timeout: 3000 });
            if (response.data && response.data.status === 'success') {
                const info = {
                    city: response.data.city,
                    region: response.data.regionName,
                    country: response.data.countryCode,
                    isp: response.data.isp,
                    org: response.data.org
                };
                this.locationCache[this.remoteIp] = info;
                this.geoData = info;
                return info;
            }
        } catch (e) {
            // Silently fail if offline or rate-limited
        }
        return null;
    }

    measurePing() {
        return new Promise((resolve) => {
            if (!this.remoteIp) return resolve(null);
            
            // Try pinging the game server first
            exec(`ping -n 1 ${this.remoteIp}`, (err, stdout) => {
                if (!err && stdout) {
                    const match = stdout.match(/time[=<]([\d]+)\s*ms/i);
                    if (match) {
                        const ping = parseInt(match[1]);
                        this.pingMs = ping;
                        return resolve(ping);
                    }
                }
                
                // Fallback to public DNS to estimate general network quality since AWS blocks ICMP
                exec(`ping -n 1 8.8.8.8`, (err2, stdout2) => {
                    if (!err2 && stdout2) {
                        const match2 = stdout2.match(/time[=<]([\d]+)\s*ms/i);
                        if (match2) {
                            const ping2 = parseInt(match2[1]);
                            this.pingMs = ping2;
                            return resolve(ping2);
                        }
                    }
                    resolve(null);
                });
            });
        });
    }

    measureBandwidth() {
        return new Promise((resolve) => {
            // Query actual system-wide network bandwidth rate per second
            const cmd = `powershell -NoProfile -Command "Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface | Measure-Object -Property BytesReceivedPersec, BytesSentPersec -Sum | ConvertTo-Json"`;
            exec(cmd, (err, stdout) => {
                if (err || !stdout) return resolve({ downMbps: 0, upMbps: 0 });

                try {
                    const data = JSON.parse(stdout);
                    // Match the properties in the array of MeasureInfo
                    const rxObj = Array.isArray(data) ? data.find(d => d.Property === 'BytesReceivedPersec') : null;
                    const txObj = Array.isArray(data) ? data.find(d => d.Property === 'BytesSentPersec') : null;
                    
                    const rxBytes = rxObj ? (rxObj.Sum || 0) : 0;
                    const txBytes = txObj ? (txObj.Sum || 0) : 0;

                    // Convert Bytes/sec to Mbps (bits per sec / 1,000,000)
                    const downMbps = parseFloat(((rxBytes * 8) / 1000000).toFixed(2));
                    const upMbps = parseFloat(((txBytes * 8) / 1000000).toFixed(2));

                    resolve({ downMbps, upMbps });
                } catch (e) {
                    resolve({ downMbps: 0, upMbps: 0 });
                }
            });
        });
    }
}

module.exports = NetworkTelemetry;
