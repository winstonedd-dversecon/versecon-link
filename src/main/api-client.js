const axios = require('axios');
const io = require('socket.io-client');
const { EventEmitter } = require('events');

class APIClient extends EventEmitter {
    constructor() {
        super();
        this.baseUrl = 'https://versecon.com'; // Production URL
        // this.baseUrl = 'http://localhost:3000'; // Dev URL (configurable)
        this.socket = null;
        this.token = null;
        this.user = null;
    }

    async login(rsiHandle) {
        // For MVP, we might need a way to grab the token or login flow.
        // Since this is a local app, we can maybe ask user to paste an API Key or Token?
        // OR, we use the existing web auth flow (open browser, callback).

        // SIMPLEST MVP: User pastes their Session Token from the website (found in cookies/localstorage)
        // Advanced: Electron Oauth.

        // Let's assume Config for now, or just public data?
        // Public data is enough for "Target User" party info if we have an endpoint.

        // But to see "My Party", we need to be auth'd.
        console.log('[API] Login logic placeholder');
    }

    connectSocket(token) {
        if (this.socket) {
            this.socket.disconnect();
        }

        this.token = token;

        // Production URL
        this.socket = io(this.baseUrl, {
            query: { token },
            reconnection: true,
            reconnectionAttempts: 10
        });

        this.socket.on('connect', () => {
            console.log('[API] Socket Connected');
            this.emit('status', { connected: true });
        });

        this.socket.on('disconnect', () => {
            console.log('[API] Socket Disconnected');
            this.emit('status', { connected: false });
        });

        this.socket.on('connect_error', (err) => {
            console.error('[API] Socket Connection Error:', err.message);
            this.emit('status', { connected: false, error: err.message });
        });

        this.socket.on('party:update', (data) => {
            console.log('[API] Party Update Received', data);
            this.emit('party', data);
        });

        this.socket.on('job:update', (data) => {
            this.emit('job', data);
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
}

module.exports = new APIClient();
