/**
 * squad-peer.js
 *
 * Connects to a squad host using the decoded IP+port from a friend code.
 * Sends local player status updates; receives full squad state from host.
 */

const WebSocket = require('ws');
const { EventEmitter } = require('events');
const { decodeCode } = require('./squad-host');

class SquadPeer extends EventEmitter {
    constructor() {
        super();
        this.ws         = null;
        this.connected  = false;
        this.playerInfo = null;
    }

    connect(code, playerInfo) {
        const { ip, port } = decodeCode(code.trim().toUpperCase());
        this.playerInfo = playerInfo;

        const url = `ws://${ip}:${port}`;
        console.log('[SquadPeer] Connecting to', url);

        this.ws = new WebSocket(url, { handshakeTimeout: 8000 });

        this.ws.on('open', () => {
            this.connected = true;
            console.log('[SquadPeer] Connected');
            this.ws.send(JSON.stringify({
                type:   'player:hello',
                handle: playerInfo.handle || 'Unknown',
                data:   playerInfo,
            }));
            this.emit('connected');
        });

        this.ws.on('message', raw => {
            try {
                const msg = JSON.parse(raw);
                if (msg.type === 'squad:state' || msg.type === 'squad:update') {
                    this.emit('squad:update', msg.data);
                }
            } catch (e) {
                console.error('[SquadPeer] Bad message:', e.message);
            }
        });

        this.ws.on('close', () => {
            this.connected = false;
            console.log('[SquadPeer] Disconnected');
            this.emit('disconnected');
        });

        this.ws.on('error', err => {
            console.error('[SquadPeer] Error:', err.message);
            this.emit('error', err.message);
        });
    }

    sendUpdate(data) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'player:update', data }));
        }
    }

    disconnect() {
        this.ws?.close();
        this.ws = null;
        this.connected = false;
    }
}

module.exports = { SquadPeer };
