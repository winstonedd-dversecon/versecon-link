const axios = require('axios');
const io = require('socket.io-client');
const { EventEmitter } = require('events');

class APIClient extends EventEmitter {
    constructor() {
        super();
        this.baseUrl = 'https://versecon.space'; // Production URL
        // this.baseUrl = 'http://localhost:3000'; // Dev URL (configurable)
        this.socket = null;
        this.token = null;
        this.user = null;
    }

    async login(rsiHandle) {
        console.log('[API] Login logic placeholder');
    }

    connectSocket(token) {
        if (this.socket) {
            this.socket.disconnect();
        }

        this.token = token;

        this.socket = io(this.baseUrl, {
            query: { token },
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 2000
        });

        this.socket.on('connect', () => {
            console.log('[API] Socket Connected');
            this.emit('status', { connected: true });
        });

        this.socket.on('disconnect', (reason) => {
            console.log('[API] Socket Disconnected:', reason);
            this.emit('status', { connected: false, reason });
        });

        this.socket.on('connect_error', (err) => {
            console.error('[API] Socket Connection Error:', err.message);
            this.emit('status', { connected: false, error: err.message });
        });

        // ═══ PARTY / SOCIAL ═══
        this.socket.on('party:update', (data) => {
            console.log('[API] Party Update Received', data);
            this.emit('party', data);
        });

        // ═══ VERSECON PLATFORM EVENTS ═══
        this.socket.on('job:created', (data) => {
            console.log('[API] New Contract:', data);
            this.emit('job', { ...data, eventType: 'created' });
        });

        this.socket.on('job:update', (data) => {
            this.emit('job', { ...data, eventType: 'update' });
        });

        this.socket.on('beacon:created', (data) => {
            console.log('[API] New Beacon:', data);
            this.emit('beacon', data);
        });

        this.socket.on('party:created', (data) => {
            console.log('[API] New Operation/LFG:', data);
            this.emit('party_event', data);
        });

        this.socket.on('trade:match', (data) => {
            console.log('[API] Trade Match:', data);
            this.emit('trade', data);
        });

        // ═══ COMMAND MODULE ═══
        this.socket.on('command:receive', (data) => {
            console.log('[API] Command Received:', data);
            this.emit('command', data);
        });

        this.socket.on('command:status', (data) => {
            console.log('[API] Command ACK Status:', data);
            this.emit('command_status', data);
        });

        // ═══ NOTIFICATIONS ═══
        this.socket.on('notification', (data) => {
            this.emit('notification', data);
        });
    }

    async updateLocation(loc) {
        if (!this.token) return;
        try {
            await axios.post(`${this.baseUrl}/api/me/location`, { location: loc.value }, {
                headers: { 'x-session-token': this.token }
            });
        } catch (e) {
            console.error('[API] Failed to push location', e.message);
        }
    }

    async sendCommand(commandData) {
        if (!this.token) return;
        try {
            await axios.post(`${this.baseUrl}/api/command/send`, commandData, {
                headers: { 'x-session-token': this.token }
            });
        } catch (e) {
            console.error('[API] Failed to send command', e.message);
            // Fallback: emit via socket
            if (this.socket && this.socket.connected) {
                this.socket.emit('command:send', commandData);
            }
        }
    }

    async ackCommand(commandId) {
        if (!this.token) return;
        try {
            await axios.post(`${this.baseUrl}/api/command/ack`, { commandId }, {
                headers: { 'x-session-token': this.token }
            });
        } catch (e) {
            console.error('[API] Failed to ACK command', e.message);
            if (this.socket && this.socket.connected) {
                this.socket.emit('command:ack', { commandId });
            }
        }
    }
}

module.exports = new APIClient();
