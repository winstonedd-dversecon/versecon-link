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
        this.socket.on('party:update', (data) => this.emit('party', data));
        this.socket.on('party:attendee-update', (data) => this.emit('party', data));

        // ═══ VERSECON PLATFORM EVENTS ═══
        // Jobs / Contracts
        this.socket.on('job-created', (data) => {
            console.log('[API] New Contract:', data);
            this.emit('job', { ...data, eventType: 'created' });
        });

        this.socket.on('job-accepted', (data) => this.emit('job', { ...data, eventType: 'accepted' }));
        this.socket.on('job-completed', (data) => this.emit('job', { ...data, eventType: 'completed' }));
        this.socket.on('job-cancelled', (data) => this.emit('job', { ...data, eventType: 'cancelled' }));
        this.socket.on('job-aborted', (data) => this.emit('job', { ...data, eventType: 'aborted' }));
        this.socket.on('job-ready', (data) => this.emit('job', { ...data, eventType: 'ready' }));
        this.socket.on('job-deployed', (data) => this.emit('job', { ...data, eventType: 'deployed' }));

        // Beacons / Distress
        this.socket.on('beacon:created', (data) => {
            console.log('[API] New Beacon:', data);
            this.emit('beacon', data);
        });
        this.socket.on('beacon-deployed', (data) => this.emit('beacon', { ...data, status: 'deployed' }));

        // Operations / LFG
        this.socket.on('party-created', (data) => {
            console.log('[API] New Operation/LFG:', data);
            this.emit('party_event', data);
        });
        this.socket.on('party:deployed', (data) => this.emit('party_event', { ...data, status: 'deployed' }));
        this.socket.on('party:completed', (data) => this.emit('party_event', { ...data, status: 'completed' }));

        this.socket.on('trade:match', (data) => {
            console.log('[API] Trade Match:', data);
            this.emit('trade', data);
        });

        // ═══ COMMAND MODULE ═══
        this.socket.on('command:receive', (data) => this.emit('command', data));
        this.socket.on('command:status', (data) => this.emit('command_status', data));

        // ═══ NOTIFICATIONS (Toast + Personal) ═══
        this.socket.on('notification:toast', (data) => {
            console.log('[API] Toast Notification:', data);
            this.emit('notification', data);
        });
        this.socket.on('notification:personal', (data) => {
            console.log('[API] Personal Notification:', data);
            this.emit('notification', data);
        });
        // Fallback for legacy generic event
        this.socket.on('notification', (data) => this.emit('notification', data));
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
