/**
 * squad-host.js
 *
 * One player starts a squad session. This opens a local WebSocket server,
 * attempts UPnP port forwarding, fetches the public IP, and returns a
 * shareable friend code that encodes IP+port.
 *
 * Other players decode the code and connect via squad-peer.js.
 */

const WebSocket = require('ws');
const http      = require('http');
const https     = require('https');
const { EventEmitter } = require('events');

// ── Code encoding (IP + port → 10-char alphanumeric) ─────────────────────────

const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function encodeCode(ip, port) {
    const parts = ip.split('.').map(Number);
    const ipInt = (parts[0] << 24 | parts[1] << 16 | parts[2] << 8 | parts[3]) >>> 0;
    // Pack into a BigInt: high 32 bits = IP, low 16 bits = port
    let n = BigInt(ipInt) * 65536n + BigInt(port);
    let code = '';
    for (let i = 0; i < 10; i++) {
        code = B36[Number(n % 36n)] + code;
        n = n / 36n;
    }
    return code;
}

function decodeCode(code) {
    let n = 0n;
    for (const c of code.toUpperCase()) {
        n = n * 36n + BigInt(B36.indexOf(c));
    }
    const port  = Number(n % 65536n);
    const ipInt = Number(n / 65536n);
    const ip = [
        (ipInt >>> 24) & 0xFF,
        (ipInt >>> 16) & 0xFF,
        (ipInt >>>  8) & 0xFF,
         ipInt         & 0xFF,
    ].join('.');
    return { ip, port };
}

// ── Fetch public IP ───────────────────────────────────────────────────────────

function getPublicIP() {
    return new Promise((resolve, reject) => {
        https.get('https://api.ipify.org', res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(data.trim()));
        }).on('error', reject);
    });
}

// ── NAT-UPnP (optional) ──────────────────────────────────────────────────────

async function tryUPnP(port) {
    try {
        const natUpnp = require('nat-upnp');
        const client  = natUpnp.createClient();
        await new Promise((resolve, reject) => {
            client.portMapping({
                public:      port,
                private:     port,
                ttl:         3600,
                description: 'VerseCon Squad',
            }, err => err ? reject(err) : resolve());
        });
        return true;
    } catch (e) {
        console.warn('[SquadHost] UPnP failed (not critical):', e.message);
        return false;
    }
}

// ── SquadHost ────────────────────────────────────────────────────────────────

class SquadHost extends EventEmitter {
    constructor() {
        super();
        this.wss       = null;
        this.port      = null;
        this.code      = null;
        this.players   = new Map(); // ws → { handle, health, ship, location, ... }
        this.hostInfo  = null;
    }

    async start(hostInfo, preferredPort = null) {
        this.hostInfo = hostInfo;
        this.port = preferredPort || 30000;

        // Start WS server
        this.wss = new WebSocket.Server({ port: this.port });
        console.log('[SquadHost] WS server on port', this.port);

        this.wss.on('connection', ws => this._onConnect(ws));
        this.wss.on('error', err => console.error('[SquadHost] WS error:', err.message));

        // Try UPnP (non-blocking)
        const upnpOk = await tryUPnP(this.port);

        // Get public IP
        let publicIP;
        try {
            publicIP = await getPublicIP();
        } catch (e) {
            console.warn('[SquadHost] Public IP fetch failed, using localhost');
            publicIP = '127.0.0.1';
        }

        this.code = encodeCode(publicIP, this.port);
        console.log(`[SquadHost] Code: ${this.code} (${publicIP}:${this.port}, UPnP: ${upnpOk})`);

        return { code: this.code, port: this.port, publicIP, upnpOk };
    }

    _onConnect(ws) {
        console.log('[SquadHost] Player connected');

        ws.on('message', raw => {
            try {
                const msg = JSON.parse(raw);
                if (msg.type === 'player:hello') {
                    this.players.set(ws, {
                        handle:   msg.handle || 'Unknown',
                        health:   100,
                        ship:     '',
                        location: '',
                        ...msg.data,
                    });
                    // Send them the current squad state
                    this._send(ws, 'squad:state', this._squadList());
                } else if (msg.type === 'player:update') {
                    const prev = this.players.get(ws) || {};
                    this.players.set(ws, { ...prev, ...msg.data });
                }
                // Broadcast updated squad to everyone
                this._broadcast('squad:update', this._squadList());
                this.emit('squad:update', this._squadList());
            } catch (e) {
                console.error('[SquadHost] Bad message:', e.message);
            }
        });

        ws.on('close', () => {
            const info = this.players.get(ws);
            this.players.delete(ws);
            console.log('[SquadHost] Player left:', info?.handle);
            this._broadcast('squad:update', this._squadList());
            this.emit('squad:update', this._squadList());
        });

        ws.on('error', err => console.error('[SquadHost] Client error:', err.message));
    }

    // Update the host's own status and broadcast to all peers
    updateHostStatus(data) {
        this.hostInfo = { ...this.hostInfo, ...data };
        this._broadcast('squad:update', this._squadList());
        this.emit('squad:update', this._squadList());
    }

    _squadList() {
        const list = [];
        // Host is always first
        if (this.hostInfo) list.push({ ...this.hostInfo, isHost: true });
        this.players.forEach(p => list.push(p));
        return list;
    }

    _send(ws, type, data) {
        if (ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ type, data }));
    }

    _broadcast(type, data) {
        const msg = JSON.stringify({ type, data });
        this.wss?.clients.forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) ws.send(msg);
        });
    }

    stop() {
        this.wss?.close();
        this.wss  = null;
        this.code = null;
        this.players.clear();
    }
}

module.exports = { SquadHost, decodeCode, encodeCode };
