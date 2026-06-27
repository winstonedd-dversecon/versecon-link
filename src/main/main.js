const { app, BrowserWindow, ipcMain, screen, dialog, Tray, Menu, nativeImage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const WebSocket = require('ws'); // For client connections (Twitch IRC)
const express = require('express');
const http = require('http');
const LogWatcher = require('./log-watcher');
const APIClient = require('./api-client');
const UpdateManager = require('./update-manager'); // Phase 6
const TelemetryEngine = require('./telemetry/telemetry-engine'); // Phase 6 Telemetry
const axios = require('axios');
const Tesseract = require('tesseract.js');
const screenshot = require('screenshot-desktop');

let dashboardWindow;
let splashWindow;
let overlayWindow;
let alertWindow;
let cncWindow; // v2.8 CNC Overlay
let squadHudWindow; // v2.10 Squad HUD
let ocrDebugWindow; // v2.10.2 OCR Debug
let netProximityHudWindow = null; // Net & Proximity HUD Overlay
let remoteApp = null;
let remoteServer = null;
let tray = null;
let parkingUpdateManager = null;
let telemetryEngine = null; // Telemetry Instance
let streamChatService = null;
let squadManager = null; // v2.8 Squad Sync
let isQuitting = false;
let dndMode = false;
let gameActive = false;
let recentDetections = [];
let recentShipNotifications = {}; // ship name -> last notification timestamp (ms)
let lastHudWarningTimes = {}; // warning text -> last speech timestamp (ms)
let lastHudWarningBroadcastTimes = {}; // warning text -> last broadcast timestamp (ms)

// ═══ SQUAD SYNC MANAGER (v2.8) ═══
// ═══ SQUAD SYNC MANAGER (v2.8) ═══
class SquadManager {
    constructor() {
        this.wss = null;
        this.ws = null;
        this.upnpClient = null;
        this.role = 'OFF'; // OFF | HOST | JOIN
        this.peers = {}; // Map of user handle -> { health, pos, lastUpdate }
        this.hostIp = null;
        this.upnpStatus = 'None';
    }

    host() {
        this.stop();
        this.role = 'HOST';
        this.wss = new WebSocketServer({ port: 55100 });
        console.log('[Squad] Hosting Relay on port 55100');

        // UPnP Auto-Port Forwarding
        try {
            this.upnpClient = require('nat-upnp').createClient();
            this.upnpClient.portMapping({
                public: 55100,
                private: 55100,
                ttl: 0,
                description: 'VerseCon Squad Relay'
            }, (err) => {
                if (err) {
                    console.error('[Squad] UPnP Mapping Failed:', err.message);
                    this.upnpStatus = 'Failed (Manual Required)';
                } else {
                    console.log('[Squad] UPnP Mapping Successful (Port 55100)');
                    this.upnpStatus = 'Active';
                }
                broadcast('squad:status', { upnp: this.upnpStatus });
            });
        } catch (e) {
            console.error('[Squad] UPnP Init Error:', e.message);
        }

        // Add self to peers list immediately so Commander appears for themselves
        const myHandle = config.rsiHandle || 'Commander';
        this.peers[myHandle] = {
            handle: myHandle,
            team: config.userTeam || 'Alpha',
            health: 100,
            location: LogWatcher.cachedState.location || 'Unknown Orbit',
            lastUpdate: Date.now(),
            isHost: true
        };

        this.wss.on('connection', (socket, req) => {
            const ip = req.socket.remoteAddress;
            console.log('[Squad] Peer connected from:', ip);

            socket.on('message', (msg) => {
                try {
                    const data = JSON.parse(msg.toString());
                    this.handleMessage(data, socket);
                } catch (e) {
                    console.error('[Squad] Invalid message:', e.message);
                }
            });

            socket.on('close', () => {
                // Find and remove peer
                for (const [handle, peer] of Object.entries(this.peers)) {
                    if (peer._ws === socket) {
                        delete this.peers[handle];
                        this.broadcastSquad();
                        break;
                    }
                }
            });
        });

        this.broadcastSquad();
    }

    join(hostIp) {
        this.stop();
        this.role = 'JOIN';
        this.hostIp = hostIp;
        const url = `ws://${hostIp}:55100`;
        console.log('[Squad] Connecting to Host:', url);

        try {
            this.ws = new WebSocket(url);
            this.ws.on('open', () => {
                console.log('[Squad] Joined Squad Host');
                // Identity handshake
                this.send({ type: 'JOIN', handle: config.rsiHandle || 'Unknown Bear', team: config.userTeam });
            });

            this.ws.on('message', (msg) => {
                try {
                    const data = JSON.parse(msg.toString());
                    if (data.type === 'SQUAD_LIST') {
                        this.peers = data.peers;
                        this.broadcastToCnc();
                    }
                } catch (e) { }
            });

            this.ws.on('error', (e) => {
                console.error('[Squad] Join Error:', e.message);
                this.role = 'OFF';
                broadcast('squad:status', { error: 'Connection Failed: ' + e.message });
            });
        } catch (e) {
            console.error('[Squad] Failed to create socket:', e.message);
        }
    }

    stop() {
        if (this.wss) {
            this.wss.close();
            this.wss = null;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        if (this.upnpClient) {
            try {
                this.upnpClient.portUnmapping({ public: 55100 });
            } catch (e) {}
            this.upnpClient = null;
        }
        this.role = 'OFF';
        this.upnpStatus = 'None';
        this.peers = {};
        this.broadcastSquad();
    }

    handleMessage(data, socket) {
        if (data.type === 'JOIN') {
            this.peers[data.handle] = {
                handle: data.handle,
                team: data.team,
                health: 100,
                location: data.location || 'Unknown',
                lastUpdate: Date.now(),
                _ws: socket
            };
            this.broadcastSquad();
        } else if (data.type === 'HEALTH') {
            const peer = this.peers[data.handle];
            if (peer) {
                peer.health = data.value;
                peer.location = data.location || peer.location;
                peer.lastUpdate = Date.now();
                this.broadcastSquad();
            }
        }
    }

    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    shareHealth(healthVal, location) {
        if (this.role === 'JOIN') {
            this.send({ type: 'HEALTH', handle: config.rsiHandle || 'Unknown Bear', value: healthVal, location: location });
        } else if (this.role === 'HOST') {
            // As host, just record local health in peers map
            const myHandle = config.rsiHandle || 'Commander';
            if (!this.peers[myHandle]) {
                this.peers[myHandle] = { handle: myHandle, team: config.userTeam || 'Alpha', isHost: true };
            }
            this.peers[myHandle].health = healthVal;
            this.peers[myHandle].location = location || LogWatcher.cachedState.location || 'Unknown';
            this.peers[myHandle].lastUpdate = Date.now();
            this.broadcastSquad();
        }
    }

    broadcastSquad() {
        // 1. Send SQUAD_LIST to all connected workers
        if (this.role === 'HOST' && this.wss) {
            const listMsg = JSON.stringify({ type: 'SQUAD_LIST', peers: this.peers });
            this.wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) client.send(listMsg);
            });
        }
        // 2. Transmit to global app listeners (CNC Overlay)
        this.broadcastToCnc();
    }

    broadcastToCnc() {
        broadcast('squad:update', { role: this.role, peers: this.peers });
    }
}

// ═══ STREAM CHAT SERVICE (v2.10) ═══
class StreamChatService {
    constructor() {
        this.twitchWs = null;
        this.ytInterval = null;
        this.lastYtTime = null;
        this.lastYtId = null;
    }

    start() {
        this.stop();
        if (!config.overlayVisibility || !config.overlayVisibility.chatHud) return;

        if (config.twitchChannel) this.connectTwitch(config.twitchChannel);
        if (config.youtubeId) this.startYouTube(config.youtubeId);
    }

    stop() {
        if (this.twitchWs) {
            this.twitchWs.close();
            this.twitchWs = null;
        }
        if (this.ytInterval) {
            clearInterval(this.ytInterval);
            this.ytInterval = null;
        }
        this.lastYtId = null;
    }

    connectTwitch(channel) {
        const url = 'wss://irc-ws.chat.twitch.tv:443';
        this.twitchWs = new WebSocket(url);

        const normalizedChannel = channel.startsWith('#') ? channel.slice(1).toLowerCase() : channel.toLowerCase();

        this.twitchWs.on('open', () => {
            console.log('[Chat] Twitch IRC Connected');
            this.twitchWs.send('PASS SCHMOOPIIE\r\n');
            this.twitchWs.send('NICK justinfan' + Math.floor(Math.random() * 90000 + 10000) + '\r\n');
            this.twitchWs.send('JOIN #' + normalizedChannel + '\r\n');
        });

        this.twitchWs.on('message', (data) => {
            const msg = data.toString();
            if (msg.startsWith('PING')) {
                this.twitchWs.send('PONG :tmi.twitch.tv');
                return;
            }

            // Robust PRIVMSG parser: :user!user@user.tmi.twitch.tv PRIVMSG #channel :message
            const match = msg.match(/:([^!]+)![^ ]+ PRIVMSG #[^ ]+ :(.+)/);
            if (match) {
                const user = match[1];
                const text = match[2];
                // Clean up IRC control characters if any
                const cleanText = text.replace(/[\x01-\x1F\x7F-\x9F]/g, "").trim();
                this.emitMessage({ platform: 'twitch', user, text: cleanText, color: '#a855f7' });
            }
        });

        this.twitchWs.on('error', (e) => console.error('[Chat] Twitch Error:', e.message));
        this.twitchWs.on('close', () => {
            console.log('[Chat] Twitch Disconnected');
            // Auto-reconnect after 10s if still enabled
            if (config.overlayVisibility?.chatHud && config.twitchChannel) {
                setTimeout(() => { if (this.twitchWs === null) this.connectTwitch(channel); }, 10000);
            }
        });
    }

    async startYouTube(id) {
        this.stopYouTube();
        if (!id) return;
        
        console.log('[Chat] YouTube Linking:', id);
        
        // Resolve Video ID from Channel ID if needed (e.g., UC...)
        let videoId = id;
        if (id.startsWith('UC')) {
            try {
                const res = await axios.get(`https://www.youtube.com/channel/${id}/live`, { maxRedirects: 5 });
                const match = res.data.match(/\"videoId\":\"([^\"]+)\"/);
                if (match) {
                    videoId = match[1];
                    console.log('[Chat] Auto-discovered Live Video ID:', videoId);
                }
            } catch (e) {
                console.warn('[Chat] Failed to auto-discover Live ID:', e.message);
            }
        }

        this.lastYtId = videoId;
        this.emitMessage({ platform: 'youtube', user: 'System', text: 'YouTube Chat Linked (Live ID: ' + videoId + ')', color: '#ff0000' });

        // Polling loop (every 10s)
        this.ytInterval = setInterval(async () => {
            try {
                const chatUrl = `https://www.youtube.com/live_chat?v=${videoId}`;
                const res = await axios.get(chatUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
                });
                
                // Extract ytInitialData
                const dataMatch = res.data.match(/window\[\"ytInitialData\"\] = ({.*?});/);
                if (!dataMatch) return;
                
                const data = JSON.parse(dataMatch[1]);
                const actions = data?.contents?.liveChatRenderer?.actions || [];
                
                actions.forEach(action => {
                    const item = action?.addChatItemAction?.item?.liveChatTextMessageRenderer;
                    if (!item) return;

                    const msgId = item.id;
                    const timestamp = parseInt(item.timestampUsec) / 1000;
                    
                    // Only new messages within last 15s to avoid initial flood
                    if (this.lastYtTime && timestamp <= this.lastYtTime) return;

                    const user = item.authorName?.simpleText || 'Unknown';
                    const text = item.message?.runs?.map(r => r.text).join('') || '';
                    
                    this.emitMessage({ platform: 'youtube', user, text, color: '#f87171' });
                });

                this.lastYtTime = Date.now() - 5000; // Overlap slightly to catch late arrivals
            } catch (err) {
                console.error('[Chat] YouTube Poll Error:', err.message);
            }
        }, 10000);
    }

    stopYouTube() {
        if (this.ytInterval) {
            clearInterval(this.ytInterval);
            this.ytInterval = null;
        }
        this.lastYtId = null;
    }

    emitMessage(data) {
        if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.webContents.send('chat:message', data);
        }
    }
}

// ═══ FEATURE FLAGS ═══
const IS_ADMIN = process.env.VCON_ROLE === 'admin' || process.env.VCON_DEV === 'true';
console.log('[Main] Role:', IS_ADMIN ? 'ADMIN/DEV' : 'USER');


let config = {
    shipMap: {},
    customPatterns: [],
    customLocations: {},
    soundEnabled: false,
    hudWarningsEnabled: false,
    hudFlashEnabled: true,
    enableFreightElevatorAlerts: true,
    enableSquadProximityRadar: true,
    enableJurisdictionAlerts: true,
    enableStaminaOxygenAlerts: true,
    farmingWishlist: [],
    activeRun: null,
    overlayVisibility: {
        hudTop: false,
        sessionInfo: false,
        systemInfo: false,
        shipStatus: false,
        locationZone: false,
        rightPanel: false,
        partyList: false,
        tacticalFeed: false,
        shipVisualizer: false,
        chatHud: false,
        nearbyPlayers: false,
        healthMonitor: false,
        networkPanel: false,
        farmingWishlist: false
    }
};
let patternDatabase = { patterns: [] };
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

// Helper to access static patterns from instance
const DEFAULT_PATTERNS = LogWatcher.constructor.DEFAULT_PATTERNS; // Ensure this is not empty

// ═══════════════════════════════════════════════════════
// CONFIG HELPERS
// ═══════════════════════════════════════════════════════

function generateFriendCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
            config = JSON.parse(data);
            if (!config.shipMap) config.shipMap = {};
            if (!config.customPatterns) config.customPatterns = [];
            if (!config.customLocations) config.customLocations = {};
            if (!config.overlayPositions) config.overlayPositions = {};
            if (!config.teamNames) config.teamNames = ["Alpha", "Bravo", "Charlie", "Delta"];
            if (!config.userTeam) config.userTeam = "Alpha";
            if (!config.hueBridge) config.hueBridge = "";
            if (!config.hueUser) config.hueUser = "";
            if (!config.hueLights) config.hueLights = ["1"];
            if (config.hueEnabled === undefined) config.hueEnabled = false;
            
            // Health Monitoring (v2.10)
            if (!config.healthZone) config.healthZone = null;
            if (config.monitorHealth === undefined) config.monitorHealth = false;
            if (config.healthFreq === undefined) config.healthFreq = 5;

            if (config.soundEnabled === undefined) config.soundEnabled = false;
            if (config.hudWarningsEnabled === undefined) config.hudWarningsEnabled = true;
            if (config.hudFlashEnabled === undefined) config.hudFlashEnabled = true;
            if (config.filterAIShips === undefined) config.filterAIShips = false;

            if (!config.overlayVisibility) {
                config.overlayVisibility = {
                    hudTop: false,
                    sessionInfo: false,
                    systemInfo: false,
                    shipStatus: false,
                    locationZone: false,
                    rightPanel: false,
                    partyList: false,
                    tacticalFeed: false,
                    shipVisualizer: false,
                    chatHud: false,
                    nearbyPlayers: false,
                    healthMonitor: false,
                    networkPanel: false,
                    farmingWishlist: false
                };
            } else {
                const props = [
                    'hudTop', 'sessionInfo', 'systemInfo', 'shipStatus', 'locationZone',
                    'rightPanel', 'partyList', 'tacticalFeed', 'shipVisualizer', 'chatHud',
                    'nearbyPlayers', 'healthMonitor', 'networkPanel', 'farmingWishlist'
                ];
                props.forEach(p => {
                    if (config.overlayVisibility[p] === undefined) {
                        config.overlayVisibility[p] = false;
                    }
                });
            }
            if (!config.accentColor) config.accentColor = '#ffa500';
            if (!config.twitchChannel) config.twitchChannel = '';
            if (!config.youtubeId) config.youtubeId = '';
            if (config.performanceMode === undefined) config.performanceMode = false;
            if (config.logLimit === undefined) config.logLimit = 200;
            if (config.initialScanLimit === undefined) config.initialScanLimit = 5000;
            if (config.ttsEnabled === undefined) config.ttsEnabled = true;
            if (config.ttsVolume === undefined) config.ttsVolume = 0.8;
            if (!config.ttsVoice) config.ttsVoice = '';
            if (config.rsiId === undefined) config.rsiId = '';
            if (!config.logPath) config.logPath = null; // Initialize logPath (will be auto-detected if null)
            if (!config.interdictionShips) config.interdictionShips = ['Mantis', 'AEGS_Mantis', 'Cutlass_Blue', 'DRAK_Cutlass_Blue', 'Zeus_Sentinel', 'Antares'];
            if (config.interdictionQuantumOnly === undefined) config.interdictionQuantumOnly = true;
            if (config.quantumExitsOnly === undefined) config.quantumExitsOnly = false;
            if (config.suppressMassQuantumAlerts === undefined) config.suppressMassQuantumAlerts = true;
            if (config.enableFreightElevatorAlerts === undefined) config.enableFreightElevatorAlerts = true;
            if (config.enableSquadProximityRadar === undefined) config.enableSquadProximityRadar = true;
            if (config.enableJurisdictionAlerts === undefined) config.enableJurisdictionAlerts = true;
            if (config.enableStaminaOxygenAlerts === undefined) config.enableStaminaOxygenAlerts = true;
            if (config.enableFireAlerts === undefined) config.enableFireAlerts = true;
            if (config.enableCorpseAlerts === undefined) config.enableCorpseAlerts = true;
            if (config.enableDeathAlerts === undefined) config.enableDeathAlerts = true;
            if (config.enableVehicleDestructionAlerts === undefined) config.enableVehicleDestructionAlerts = true;
            if (config.enableMissionStatusAlerts === undefined) config.enableMissionStatusAlerts = true;
            if (config.enableCrimestatAlerts === undefined) config.enableCrimestatAlerts = true;
            if (!config.farmingWishlist) config.farmingWishlist = [];
            if (!config.friendCode) {
                config.friendCode = generateFriendCode();
                saveConfig();
            }
            console.log('[Main] Config loaded:', config);
        }
    } catch (e) {
        console.error('[Main] Failed to load config:', e);
    }
}

function saveConfig() {
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        console.log('[Main] Config saved');
    } catch (e) {
        console.error('[Main] Failed to save config:', e);
    }
}

// ═══════════════════════════════════════════════════════
// WINDOW CREATION
// ═══════════════════════════════════════════════════════

function createWindows() {
    // Create Splash Window
    splashWindow = new BrowserWindow({
        width: 420,
        height: 320,
        frame: false,
        show: false,
        alwaysOnTop: true,
        resizable: false,
        backgroundColor: '#0b0c10',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });
    splashWindow.loadFile(path.join(__dirname, '../renderer/splash.html'));

    splashWindow.once('ready-to-show', () => {
        splashWindow.show();
    });

    // 1. Main Dashboard Window (show: false)
    dashboardWindow = new BrowserWindow({
        width: 1100,
        height: 750,
        frame: false,
        show: false,
        title: 'VerseCon Link',
        backgroundColor: '#0b0c10',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    dashboardWindow.loadFile(path.join(__dirname, '../renderer/dashboard.html'));

    // Swap splash for dashboard once ready
    dashboardWindow.once('ready-to-show', () => {
        setTimeout(() => {
            if (splashWindow) {
                splashWindow.destroy();
                splashWindow = null;
            }
            if (dashboardWindow) {
                dashboardWindow.show();
            }
        }, 2000); // Give the themed splash screen longer visibility (2 seconds)
    });

    dashboardWindow.webContents.on('did-finish-load', () => {
        LogWatcher.emitCurrentState();
        LogWatcher.emitUnknowns();

        // Force-set log status directly in the renderer DOM (bypasses IPC entirely)
        function forceSetLogStatus() {
            if (!dashboardWindow || dashboardWindow.isDestroyed()) return;
            const isActive = LogWatcher.isWatching;
            const logPath = LogWatcher.filePath || '';
            const dotClass = isActive ? 'dot on' : 'dot off';
            const statusText = isActive ? 'Active' : 'Searching...';
            const safeLogPath = JSON.stringify(logPath);
            const js = 'try {' +
                'var dot = document.getElementById("status-log-dot");' +
                'var txt = document.getElementById("status-log-text");' +
                'if (dot) dot.className = ' + JSON.stringify(dotClass) + ';' +
                'if (txt) txt.innerText = ' + JSON.stringify(statusText) + ';' +
                'var pathEl = document.getElementById("config-log-path");' +
                'if (pathEl && ' + safeLogPath + ') pathEl.value = ' + safeLogPath + ';' +
                '} catch(e) { console.error("[ForceStatus]", e); }';
            dashboardWindow.webContents.executeJavaScript(js)
                .catch(e => console.error('[Main] executeJavaScript failed:', e));
        }
        // Try at 1s, 3s, and 5s to cover all timing scenarios
        setTimeout(forceSetLogStatus, 1000);
        setTimeout(forceSetLogStatus, 3000);
        setTimeout(forceSetLogStatus, 5000);
        // Restore persistent spawn point if not yet in cache
        if (config.spawnPoint && !LogWatcher.cachedState.spawn) {
            LogWatcher.cachedState.spawn = config.spawnPoint;
            dashboardWindow.webContents.send('log:update', { type: 'SPAWN_POINT', value: config.spawnPoint });
        }

        // Sync Settings so dashboard UI inputs aren't blank (Fixes Hue getting wiped on first save)
        dashboardWindow.webContents.send('settings:updated', config);

        // Sync Friend Code
        dashboardWindow.webContents.send('settings:friend-code', config.friendCode);

        // Initialize Auto-Updater (Phase 6)
        if (!parkingUpdateManager) {
            parkingUpdateManager = new UpdateManager(dashboardWindow);
            parkingUpdateManager.mainWindow = dashboardWindow; // Ensure ref updates if window recreated
            // Check for updates after short delay
            setTimeout(() => {
                if (!process.env.VCON_DEV) ipcMain.emit('update:check');
            }, 5000);
        }


        // Initialize Telemetry Engine (Phase 6)
        if (!telemetryEngine) {
            telemetryEngine = new TelemetryEngine();

            LogWatcher.on('raw-line', (line) => telemetryEngine.handleLogLine(line));
            LogWatcher.on('gamestate', (data) => {
                if (data.type === 'SESSION_ID') telemetryEngine.updateSessionId(data.value);
                if (data.type === 'SERVER_CONNECTED') telemetryEngine.updateServerInfo(data.value);
            });

            telemetryEngine.on('telemetry', (data) => {
                console.log('[Main] Telemetry Event:', data.type);
                broadcast('telemetry:update', data);
            });
            telemetryEngine.start();

            // Initialize Friend Sync logic

            // ═══ STREAM CHAT (v2.10) ═══
            if (!streamChatService) {
                streamChatService = new StreamChatService();
                streamChatService.start();
            }

            // Start if path exists
            if (config.logPath) {
                console.log('[Main] Starting Telemetry Engine (Network Watcher)');
            }
        }
    });

    // 2. Overlay Window (Transparent HUD)
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;

    overlayWindow = new BrowserWindow({
        width: width,
        height: height,
        x: 0,
        y: 0,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        alwaysOnTop: true,
        resizable: false,
        skipTaskbar: true,
        focusable: false, // Don't steal focus from game
        type: 'toolbar_menu', // Better for overlays
        show: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    overlayWindow.once('ready-to-show', () => {
        overlayWindow.show();
    });

    // Pass through clicks to game, but allow interaction with UI
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });

    // IPC to toggle mouse events when hovering UI
    ipcMain.on('overlay:details-interaction', (event, { active }) => {
        if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.setIgnoreMouseEvents(!active, { forward: true });
        }
    });

    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    overlayWindow.loadFile(path.join(__dirname, '../renderer/overlay.html'));

    overlayWindow.webContents.on('did-finish-load', () => {
        LogWatcher.emitCurrentState();
        overlayWindow.webContents.send('log:status', { connected: LogWatcher.isWatching, path: LogWatcher.filePath });
        overlayWindow.webContents.send('settings:updated', config);
    });

    // 3. Alert Window (Full-screen transparent for HUD warnings)
    alertWindow = new BrowserWindow({
        width: primaryDisplay.size.width,
        height: primaryDisplay.size.height,
        x: 0,
        y: 0,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        alwaysOnTop: true,
        resizable: false,
        skipTaskbar: true,
        focusable: false,
        show: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    alertWindow.loadFile(path.join(__dirname, '../renderer/alert.html'));
    alertWindow.webContents.on('did-finish-load', () => {
        alertWindow.webContents.send('settings:updated', config);
    });
    alertWindow.setIgnoreMouseEvents(true, { forward: true });
    alertWindow.setAlwaysOnTop(true, 'screen-saver'); // Fix: Ensure it shows over game
    alertWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

}

// ═══ START SERVICES ═══
startRemoteServer();

// ═══════════════════════════════════════════════════════
// SYSTEM TRAY
// ═══════════════════════════════════════════════════════

function createTray() {
    // Create a simple 16x16 tray icon using nativeImage
    const iconSize = 16;
    const icon = nativeImage.createEmpty();

    // Use a data URL for a simple orange circle icon
    const canvas = `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA0ElEQVQ4T2NkoBAwUqifYdAY8J+B4T8jI+N/BkZGJgZGxv8MDIz/GUBsJkYQm5GRiQHEBvGRxYDqGJHVwA1ghBvACHYBCzPLfwYGA2AgywDAwMIAMgHkB5AwUZ4DCgBEmBjUA5C1kcYpigJmJCRQFEDYoOFBDABYDDIwMYDaID/MCTB5kCCPYAAZkNSCbwM5AhoEFCCiGoGrAAUEhGECuZkQXYwIbAvIGVhv+w4MAuxgj2A0ENAFhLgAA4aVjEV2F5y4AAAAASUVORK5CYII=`;

    tray = new Tray(nativeImage.createFromDataURL(canvas));
    tray.setToolTip('VerseCon Link — Connected');

    updateTrayMenu();

    tray.on('click', () => {
        if (dashboardWindow && !dashboardWindow.isDestroyed()) {
            if (dashboardWindow.isVisible()) {
                dashboardWindow.focus();
            } else {
                dashboardWindow.show();
            }
        }
    });
}

function updateTrayMenu() {
    if (!tray) return;

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Show Dashboard',
            click: () => {
                if (dashboardWindow && !dashboardWindow.isDestroyed()) {
                    dashboardWindow.show();
                    dashboardWindow.focus();
                }
            }
        },
        {
            label: overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible() ? 'Hide Overlay' : 'Show Overlay',
            click: () => {
                if (overlayWindow && !overlayWindow.isDestroyed()) {
                    overlayWindow.isVisible() ? overlayWindow.hide() : overlayWindow.show();
                    updateTrayMenu();
                }
            }
        },
        { type: 'separator' },
        {
            label: 'Do Not Disturb',
            type: 'checkbox',
            checked: dndMode,
            click: (menuItem) => {
                dndMode = menuItem.checked;
                broadcast('app:dnd', { enabled: dndMode });
            }
        },
        { type: 'separator' },
        {
            label: 'Quit VerseCon Link',
            click: () => {
                isQuitting = true;
                app.quit();
            }
        }
    ]);

    tray.setContextMenu(contextMenu);
}

function showTrayNotification(title, body, onClick = null) {
    if (dndMode) return;
    if (!Notification.isSupported()) return;

    const notif = new Notification({
        title,
        body,
        icon: nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA0ElEQVQ4T2NkoBAwUqifYdAY8J+B4T8jI+N/BkZGJgZGxv8MDIz/GUBsJkYQm5GRiQHEBvGRxYDqGJHVwA1ghBvACHYBCzPLfwYGA2AgywDAwMIAMgHkB5AwUZ4DCgBEmBjUA5C1kcYpigJmJCRQFEDYoOFBDABYDDIwMYDaID/MCTB5kCCPYAAZkNSCbwM5AhoEFCCiGoGrAAUEhGECuZkQXYwIbAvIGVhv+w4MAuxgj2A0ENAFhLgAA4aVjEV2F5y4AAAAASUVORK5CYII='),
        silent: false
    });

    if (onClick) {
        notif.on('click', onClick);
    }

    notif.show();
}

// Update tray tooltip with connection status
function updateTrayStatus(logConnected, apiConnected) {
    if (!tray) return;
    const status = logConnected && apiConnected ? 'Connected'
        : logConnected ? 'Game Log Active'
            : apiConnected ? 'API Only'
                : 'Disconnected';
    tray.setToolTip(`VerseCon Link — ${status}`);
}

// ═══════════════════════════════════════════════════════
// IPC HANDLERS
// ═══════════════════════════════════════════════════════

ipcMain.on('app:login', (event, token) => {
    APIClient.token = token;
    APIClient.connectSocket(token);
    // Register this user's friend code with the server so others can find them
    if (config.friendCode) APIClient.registerFriendCode(config.friendCode);
});

// ── Friend / Social IPC ──────────────────────────────────────────────────────
ipcMain.handle('social:add-friend', async (event, code) => {
    try {
        const result = await APIClient.addFriendByCode(code.trim().toUpperCase());
        // Refresh friend list and push to renderer
        const friends = await APIClient.fetchFriendList();
        if (dashboardWindow) dashboardWindow.webContents.send('social:friends-updated', friends);
        return { success: true, result };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('social:get-friends', async () => {
    try {
        const friends = await APIClient.fetchFriendList();
        return { success: true, friends };
    } catch (e) {
        return { success: false, friends: [], error: e.message };
    }
});

ipcMain.handle('social:remove-friend', async (event, friendId) => {
    try {
        await APIClient.removeFriend(friendId);
        const friends = await APIClient.fetchFriendList();
        if (dashboardWindow) dashboardWindow.webContents.send('social:friends-updated', friends);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.on('app:toggle-overlay', () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        if (overlayWindow.isVisible()) {
            overlayWindow.hide();
        } else {
            overlayWindow.show();
        }
        updateTrayMenu();
    }
});

ipcMain.handle('app:select-log', async () => {
    const result = await dialog.showOpenDialog(dashboardWindow, {
        properties: ['openFile'],
        filters: [{ name: 'Log Files', extensions: ['log', 'txt'] }]
    });

    if (!result.canceled && result.filePaths.length > 0) {
        const filePath = result.filePaths[0];

        // FIX 5: Properly restart LogWatcher on path change
        if (filePath && filePath !== config.logPath) {
            config.logPath = filePath;
            saveConfig();
            console.log('[Main] Log path changed to:', filePath);

            // Stop old watcher and start new one
            LogWatcher.stop();
            setTimeout(() => {
                LogWatcher.start(filePath);
                broadcast('log:status', { connected: true, path: filePath });
                console.log('[Main] LogWatcher restarted with new path:', filePath);
            }, 500);

            // Update Telemetry Engine if available
            if (telemetryEngine) {
                telemetryEngine.setLogPath(filePath);
            }

            return filePath;
        }
        return config.logPath;
    }
    return null;
});

ipcMain.handle('app:get-role', async () => {
    return { isAdmin: IS_ADMIN, isDev: !!process.env.VCON_DEV };
});

ipcMain.handle('app:open-external', async (event, url) => {
    const { shell } = require('electron');
    await shell.openExternal(url);
    return true;
});

// Select ship image
ipcMain.handle('app:select-ship-image', async () => {
    const result = await dialog.showOpenDialog(dashboardWindow, {
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
    });

    if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
    }
    return null;
});

// ═══ OCR SCANNER IPC (NEW) ═══
ipcMain.handle('ocr:capture-screen', async () => {
    try {
        console.log('[OCR] Listing displays...');
        const displays = await screenshot.listDisplays();
        console.log('[OCR] Found displays:', displays.map(d => ({ id: d.id, name: d.name })));
        
        if (!displays || displays.length === 0) {
            throw new Error('No displays detected. Check permissions or monitor connections.');
        }
        
        // Take primary screen (usually id 0 or first in list)
        const primary = displays.find(d => d.primary) || displays[0];
        console.log('[OCR] Attempting capture on screen:', primary.id);
        
        const img = await screenshot({ screen: primary.id, format: 'png' });
        if (!img || img.length === 0) {
            throw new Error('Capture returned an empty image buffer.');
        }
        
        return `data:image/png;base64,${img.toString('base64')}`;
    } catch (err) {
        console.error('[OCR] Primary capture failed:', err.message);
        try {
            console.log('[OCR] Attempting generic fallback capture...');
            const img = await screenshot({ format: 'png' });
            return `data:image/png;base64,${img.toString('base64')}`;
        } catch (innerErr) {
            console.error('[OCR] Global capture failed:', innerErr.message);
            throw new Error(`Screen capture failed: ${err.message}. (Fallback: ${innerErr.message})`);
        }
    }
});

ipcMain.handle('ocr:process', async (event, dataUrl) => {
    try {
        console.log('[OCR] Starting structural analysis...');
        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
        const imageBuffer = Buffer.from(base64Data, 'base64');

        const { data } = await Tesseract.recognize(imageBuffer, 'eng');
        
        // v2.10.2 - Extract structural word data for anchor tracking
        const words = data.words.map(w => ({
            text: w.text,
            confidence: w.confidence,
            bbox: w.bbox // { x0, y0, x1, y1 }
        }));

        console.log(`[OCR] Analysis complete. Found ${words.length} words.`);
        return {
            text: data.text.trim(),
            words: words
        };
    } catch (err) {
        console.error('[OCR] Processing failed:', err);
        throw err;
    }
});

// Alert window control
ipcMain.on('alert:show', (event, data) => {
    if (config.hudWarningsEnabled && alertWindow && !alertWindow.isDestroyed()) {
        alertWindow.show();
        alertWindow.webContents.send('alert:trigger', data);
    }
});

ipcMain.on('alert:hide', () => {
    if (alertWindow && !alertWindow.isDestroyed()) {
        alertWindow.hide();
    }
});

// Overlay movement
ipcMain.on('overlay:move', (event, { x, y }) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.setPosition(Math.round(x), Math.round(y));
    }
});

ipcMain.on('overlay:get-position', (event) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        const pos = overlayWindow.getPosition();
        event.reply('overlay:position', { x: pos[0], y: pos[1] });
    }
});

// ═══ HEALTH MONITORING IPC (v2.10) ═══
ipcMain.on('app:update-health', (event, healthVal) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('player:health-update', healthVal);
    }
});

// Alert cooldown settings
ipcMain.on('alert:set-cooldown', (event, { alertType, cooldownMs }) => {
    LogWatcher.setAlertCooldown(alertType, cooldownMs);
});

// Command module IPC
ipcMain.on('command:send', (event, data) => {
    // Forward command to API
    if (APIClient.socket && APIClient.socket.connected) {
        APIClient.socket.emit('command:send', data);
    }
    // Also broadcast locally for preview
    broadcast('command:sent', data);

    // v2.2 - Broadcast to Overlay/Alert Windows
    if (config.hudWarningsEnabled && alertWindow && !alertWindow.isDestroyed()) {
        alertWindow.show();
        alertWindow.webContents.send('alert:trigger', { type: 'COMMAND', value: data });
    }
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('alert:trigger', { type: 'COMMAND', value: data });
    }
});

// Command overlay (local-only display on HUD)
ipcMain.on('command:overlay', (event, data) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('log:update', {
            type: 'HUD_WARNING',
            value: `[${data.target || 'ALL'}] ${data.command}`,
            level: 'WARNING'
        });
    }
});

// ═══ UNKNOWN LOG TRACKING ═══
// Forward LogWatcher's built-in unknown tracking to dashboard
LogWatcher.on('unknown', (data) => {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
        // LogWatcher emits { groups: [{sample, count, firstSeen, lastSeen}], totalGroups }
        // Dashboard renderUnknowns() expects [{group, count, sample}]
        const formatted = (data.groups || []).map(g => ({
            group: g.sample ? g.sample.substring(0, 80) : 'Unknown',
            count: g.count,
            sample: g.sample
        }));
        dashboardWindow.webContents.send('log:unknown', { groups: formatted });
    }
});

ipcMain.on('log:request-unknowns', () => {
    LogWatcher.emitUnknowns(); // Re-triggers the 'unknown' event above
});

ipcMain.on('log:clear-unknowns', () => {
    LogWatcher.clearUnknowns(); // Clears + re-emits
});

ipcMain.on('log:ignore-unknown', (event, tag) => {
    LogWatcher.ignoreUnknownPattern(tag); // Ignore + re-emit
});

ipcMain.handle('log:get-status', () => {
    return { connected: LogWatcher.isWatching, path: LogWatcher.filePath };
});

ipcMain.on('command:ack', (event, data) => {
    if (APIClient.socket && APIClient.socket.connected) {
        APIClient.socket.emit('command:ack', data);
    }
});

// Window minimize handler
ipcMain.on('window:minimize', () => {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
        dashboardWindow.minimize();
    }
});

// Window close handler
ipcMain.on('window:close', () => {
    isQuitting = true;
    app.quit();
});

// Mission rename handler
ipcMain.on('mission:rename', (event, { id, name }) => {
    if (!config.activeMissions) config.activeMissions = {};
    if (config.activeMissions[id]) {
        config.activeMissions[id].title = name;
        saveConfig();
        broadcast('mission:list', Object.values(config.activeMissions));
    }
});

// Unknown log management
ipcMain.on('log:ignore-unknown', (event, key) => {
    LogWatcher.ignoreUnknownPattern(key);
});

ipcMain.on('log:clear-unknowns', () => {
    LogWatcher.clearUnknowns();
});

ipcMain.on('log:request-unknowns', () => {
    LogWatcher.emitUnknowns();
});

// Custom Locations
const NavigationParser = require('./parsers/navigation');
// Initialize with config - NOW MOVED INTO app.whenReady() for proper timing

// Custom location save handled by ipcMain.handle('settings:save-custom-locations') below
// (removed duplicate ipcMain.on handler)

// Generic Settings Save
ipcMain.on('settings:save', (event, newConfig) => {
    // Merge known keys
    if (newConfig.logPath !== undefined) config.logPath = newConfig.logPath;
    if (newConfig.volume !== undefined) config.volume = newConfig.volume;
    if (newConfig.soundEnabled !== undefined) config.soundEnabled = newConfig.soundEnabled;
    if (newConfig.overlayEnabled !== undefined) config.overlayEnabled = newConfig.overlayEnabled;
    if (newConfig.autoCleanMissions !== undefined) config.autoCleanMissions = newConfig.autoCleanMissions;
    if (newConfig.shareLocation !== undefined) config.shareLocation = newConfig.shareLocation; // Phase 5
    if (newConfig.teamNames !== undefined) config.teamNames = newConfig.teamNames;
    if (newConfig.userTeam !== undefined) config.userTeam = newConfig.userTeam;
    if (newConfig.overlayPositions !== undefined) config.overlayPositions = newConfig.overlayPositions;
    if (newConfig.shareHealth !== undefined) config.shareHealth = newConfig.shareHealth;
    if (newConfig.rsiHandle !== undefined) {
        config.rsiHandle = newConfig.rsiHandle;
        try {
            require('./parsers/combat').setRsiHandle(config.rsiHandle);
            require('./parsers/social').setRsiHandle(config.rsiHandle);
            require('./parsers/navigation').setRsiHandle(config.rsiHandle);
            require('./parsers/inventory').setRsiHandle(config.rsiHandle);
        } catch (e) {
            console.warn('[Main] Could not update RSI handle on parsers:', e.message);
        }
    }
    if (newConfig.rsiId !== undefined) {
        config.rsiId = newConfig.rsiId;
        try {
            require('./parsers/social').setRsiId(config.rsiId);
        } catch (e) {
            console.warn('[Main] Could not update RSI ID on parsers:', e.message);
        }
    }

    // Philips Hue Settings
    if (newConfig.hueEnabled !== undefined) config.hueEnabled = newConfig.hueEnabled;
    if (newConfig.hueBridge !== undefined) config.hueBridge = newConfig.hueBridge;
    if (newConfig.hueUser !== undefined) config.hueUser = newConfig.hueUser;
    if (newConfig.hueLights !== undefined) config.hueLights = newConfig.hueLights;

    // Theme & Stream (v2.10)
    if (newConfig.accentColor !== undefined) config.accentColor = newConfig.accentColor;
    if (newConfig.twitchChannel !== undefined) config.twitchChannel = newConfig.twitchChannel;
    if (newConfig.youtubeId !== undefined) config.youtubeId = newConfig.youtubeId;
    if (newConfig.performanceMode !== undefined) config.performanceMode = newConfig.performanceMode;
    if (newConfig.logLimit !== undefined) config.logLimit = parseInt(newConfig.logLimit) || 200;
    if (newConfig.initialScanLimit !== undefined) config.initialScanLimit = parseInt(newConfig.initialScanLimit) || 5000;
    if (newConfig.overlayVisibility !== undefined) {
        config.overlayVisibility = { ...config.overlayVisibility, ...newConfig.overlayVisibility };
    }
    if (newConfig.ttsEnabled !== undefined) config.ttsEnabled = newConfig.ttsEnabled;
    if (newConfig.ttsVolume !== undefined) config.ttsVolume = newConfig.ttsVolume;
    if (newConfig.ttsVoice !== undefined) config.ttsVoice = newConfig.ttsVoice;

    // Health Monitoring (v2.10)
    if (newConfig.healthZone !== undefined) config.healthZone = newConfig.healthZone;
    if (newConfig.monitorHealth !== undefined) config.monitorHealth = newConfig.monitorHealth;
    if (newConfig.healthFreq !== undefined) config.healthFreq = newConfig.healthFreq;

    // Interdiction Ship Detection (v2.10.44)
    if (newConfig.interdictionShips !== undefined) {
        config.interdictionShips = newConfig.interdictionShips;
        // Propagate immediately to the running LogEngine singleton
        try {
            const logEngine = require('./parsers');
            if (logEngine && typeof logEngine.setInterdictionShips === 'function') {
                logEngine.setInterdictionShips(config.interdictionShips);
            }
        } catch (e) {
            console.warn('[Main] Could not update interdiction ships on parser:', e.message);
        }
    }
    if (newConfig.interdictionQuantumOnly !== undefined) {
        config.interdictionQuantumOnly = newConfig.interdictionQuantumOnly;
        try {
            const logEngine = require('./parsers');
            if (logEngine && typeof logEngine.setInterdictionQuantumOnly === 'function') {
                logEngine.setInterdictionQuantumOnly(config.interdictionQuantumOnly);
            }
        } catch (e) {
            console.warn('[Main] Could not update quantum-only mode on parser:', e.message);
        }
    }
    if (newConfig.quantumExitsOnly !== undefined) {
        config.quantumExitsOnly = newConfig.quantumExitsOnly;
    }
    if (newConfig.suppressMassQuantumAlerts !== undefined) {
        config.suppressMassQuantumAlerts = newConfig.suppressMassQuantumAlerts;
    }
    if (newConfig.enableFreightElevatorAlerts !== undefined) config.enableFreightElevatorAlerts = newConfig.enableFreightElevatorAlerts;
    if (newConfig.enableStaminaOxygenAlerts !== undefined) config.enableStaminaOxygenAlerts = newConfig.enableStaminaOxygenAlerts;
    if (newConfig.enableJurisdictionAlerts !== undefined) config.enableJurisdictionAlerts = newConfig.enableJurisdictionAlerts;
    if (newConfig.enableFireAlerts !== undefined) config.enableFireAlerts = newConfig.enableFireAlerts;
    if (newConfig.enableCorpseAlerts !== undefined) config.enableCorpseAlerts = newConfig.enableCorpseAlerts;
    if (newConfig.enableDeathAlerts !== undefined) config.enableDeathAlerts = newConfig.enableDeathAlerts;
    if (newConfig.enableVehicleDestructionAlerts !== undefined) config.enableVehicleDestructionAlerts = newConfig.enableVehicleDestructionAlerts;
    if (newConfig.enableMissionStatusAlerts !== undefined) config.enableMissionStatusAlerts = newConfig.enableMissionStatusAlerts;
    if (newConfig.enableCrimestatAlerts !== undefined) config.enableCrimestatAlerts = newConfig.enableCrimestatAlerts;
    if (newConfig.hudWarningsEnabled !== undefined) {
        config.hudWarningsEnabled = newConfig.hudWarningsEnabled;
    }
    if (newConfig.hudFlashEnabled !== undefined) {
        config.hudFlashEnabled = newConfig.hudFlashEnabled;
    }
    if (newConfig.filterAIShips !== undefined) {
        config.filterAIShips = newConfig.filterAIShips;
        try {
            const logEngine = require('./parsers');
            if (logEngine && typeof logEngine.setFilterAIShips === 'function') {
                logEngine.setFilterAIShips(config.filterAIShips);
            }
        } catch (e) {
            console.warn('[Main] Could not update filter AI ships on parser:', e.message);
        }
    }
    if (newConfig.farmingWishlist !== undefined) config.farmingWishlist = newConfig.farmingWishlist;
    if (newConfig.activeRun !== undefined) config.activeRun = newConfig.activeRun;

    saveConfig();


    if (streamChatService) streamChatService.start();

    // Broadcast updates if needed
    broadcast('settings:updated', config);
});

// Provide current config on demand (used by alert.html on load)
ipcMain.handle('settings:get', async () => {
    return config;
});

// ═══════════════════════════════════════════════════════
// BROADCAST (ALL WINDOWS)
// ═══════════════════════════════════════════════════════

function broadcast(channel, data) {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) dashboardWindow.webContents.send(channel, data);
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.webContents.send(channel, data);
    if (netProximityHudWindow && !netProximityHudWindow.isDestroyed()) netProximityHudWindow.webContents.send(channel, data);
    if (alertWindow && !alertWindow.isDestroyed()) alertWindow.webContents.send(channel, data);
}

// ═══════════════════════════════════════════════════════
// EVENT WIRING
// ═══════════════════════════════════════════════════════

// API Client Events
APIClient.on('party', (data) => {
    // Send to Dashboard (for feed/lists)
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
        dashboardWindow.webContents.send('api:party', data);
    }
    // Send to Overlay (for HUD list)
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('api:party', data);
    }
});
// ═══════════════════════════════════════════════════════

// Track connection states for tray
let logConnected = false;
let apiConnected = false;

// Log Watcher Events
let logBuffer = [];
let logTimeout = null;

LogWatcher.on('raw-line', (line) => {
    if (config.performanceMode) return; // Skip raw log IPC in performance mode

    logBuffer.push(line);

    if (!logTimeout) {
        logTimeout = setTimeout(() => {
            if (dashboardWindow && !dashboardWindow.isDestroyed() && logBuffer.length > 0) {
                dashboardWindow.webContents.send('log:raw-batch', logBuffer);
            }
            logBuffer = [];
            logTimeout = null;
        }, 50);
    }
});

const speak = (text) => {
    if (!config.ttsEnabled) return;
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
        dashboardWindow.webContents.send('app:tts', text);
    }
};

LogWatcher.on('gamestate', (data) => {
    // Update gameActive state based on events
    if (data.type === 'SERVER_CONNECTED' || data.type === 'SESSION_START' || data.type === 'WORLD_LOADED') {
        gameActive = true;
    } else if (data.type === 'GAME_LEAVE' || data.type === 'GAME_RESTART') {
        gameActive = false;
    }

    // Keep CombatParser currentShip reference in sync
    if (data.type === 'SHIP_ENTER' || data.type === 'SHIP_CURRENT') {
        try {
            require('./parsers/combat').currentShip = data.value;
        } catch (e) {}
    } else if (data.type === 'SHIP_EXIT') {
        try {
            require('./parsers/combat').currentShip = null;
        } catch (e) {}
    }

    // Cache states during initial scan
    if (data.type === 'SPAWN_SET') LogWatcher.cachedState.spawn = data.value;
    if (data.type === 'SHIP_ENTER') LogWatcher.cachedState.ship = data.value;
    if (data.type === 'SESSION_START') LogWatcher.cachedState.startTime = data.value;
    if (data.type === 'BUILD_INFO') LogWatcher.cachedState.build = data.value;
    if (data.type === 'HANGAR_STATE') LogWatcher.cachedState.hangarState = data.value;

    if (LogWatcher.isInitialScanning) {
        // Broadcast parsed data to windows so logs tail, but skip alerts / writing to disk
        broadcast('log:update', data);
        return;
    }

    // ═══ VOICE ALERTS (v2.10) ═══
    if (gameActive) {
        if (data.type === 'SERVER_CONNECTED' && data.value) speak(`Connected to shard ${data.value.shard || data.value}`);
        if (data.type === 'MISSION_ACCEPTED' && data.value) speak(`Mission accepted. ${data.value}`);
        if (data.type === 'SPAWN_SET' && data.value) speak(`Spawn point set to ${data.value}`);
    }

    // ═══ SHIP IMAGE RESOLUTION (must run BEFORE broadcast) ═══
    // Attach image path to ship events so overlay receives it
    if ((data.type === 'SHIP_ENTER' || data.type === 'SHIP_CURRENT') && !data.image && data.value && config.shipMap) {
        const shipName = data.value;
        const lower = shipName.toLowerCase();
        // Exact match first
        if (config.shipMap[shipName]) {
            data.image = config.shipMap[shipName];
        } else {
            // Fuzzy partial match (case-insensitive, bidirectional)
            for (const [key, imgPath] of Object.entries(config.shipMap)) {
                const keyLower = key.toLowerCase();
                if (lower.includes(keyLower) || keyLower.includes(lower)) {
                    data.image = imgPath;
                    break;
                }
            }
        }
        if (data.image) {
            console.log(`[Main] Ship image resolved: "${shipName}" → ${data.image}`);
        } else {
            console.log(`[Main] Ship image NOT found for: "${shipName}" | shipMap keys: [${Object.keys(config.shipMap).join(', ')}]`);
        }
    }

    const isWarning = ['HUD_WARNING', 'HAZARD_FIRE', 'DEATH', 'VEHICLE_DESTRUCTION', 'INTERDICTION', 'TACTICAL_PROXIMITY', 'VEHICLE_DEATH'].includes(data.type) ||
                      (data.type === 'STATUS' && (data.level === 'WARNING' || ['death', 'suffocating', 'depressurizing'].includes((data.value || '').toLowerCase()))) ||
                      (data.type === 'CUSTOM' && ['CRITICAL', 'WARN', 'WARNING'].includes(data.level));

    // Suppress HUD_WARNING alerts if the user has turned off HUD Warnings
    if (data.type === 'HUD_WARNING' && !config.hudWarningsEnabled) {
        // Still broadcast as informational (feed entry) but not as a warning
        broadcast('log:update', { ...data, type: 'STATUS', level: 'INFO' });
    } else if (data.type === 'HUD_WARNING') {
        const warnText = data.value.trim();
        const now = Date.now();
        const lastBroadcastTime = lastHudWarningBroadcastTimes[warnText] || 0;
        
        if (now - lastBroadcastTime > 15000) {
            lastHudWarningBroadcastTimes[warnText] = now;
            if (!gameActive && isWarning) {
                console.log(`[Main] Suppressed warning/alert broadcast (${data.type}) because gameActive is false.`);
            } else {
                broadcast('log:update', data);
            }
        } else {
            console.log(`[Main] Suppressed duplicate HUD warning broadcast: "${warnText}" (last broadcast ${now - lastBroadcastTime}ms ago).`);
            // Suppress from processing downstream too (TTS, reactions) by clearing data type
            return;
        }
    } else if (!gameActive && isWarning) {
        console.log(`[Main] Suppressed warning/alert broadcast (${data.type}) because gameActive is false.`);
    } else {
        broadcast('log:update', data);
    }

    // ═══ VOICE ALERTS (HUD) ═══
    if (gameActive && data.type === 'HUD_WARNING' && data.value) {
        const warnText = data.value.trim();
        const now = Date.now();
        const lastSpeakTime = lastHudWarningTimes[warnText] || 0;
        
        if (now - lastSpeakTime > 25000) {
            lastHudWarningTimes[warnText] = now;
            if (warnText.toLowerCase().includes('fire')) {
                speak('Warning. Fire detected.');
            } else {
                speak(warnText);
            }
        } else {
            console.log(`[Main] Suppressed duplicate HUD voice warning speech: "${warnText}" (last spoken ${now - lastSpeakTime}ms ago).`);
        }
    }

    // ═══ PATTERN REACTIONS (v2.8) ═══
    if (gameActive) handlePatternReactions(data);

    // ═══ HUE REACTIONS (v2.9) ═══
    if (gameActive) handleHueSituation(data);

    // ═════ FRIEND SHARING (Phase 5) ═══
    if (data.type === 'LOCATION' && config.shareLocation) {
        APIClient.updateLocation(data);
    }

    // Handle options: quantumExitsOnly and suppressMassQuantumAlerts
    let isSuppressed = false;
    if (data.type === 'RADAR_SINGLE' || (data.type === 'TACTICAL_QUANTUM' && data.direction === 'arrival') ||
        data.type === 'TACTICAL_PROXIMITY') {
        const now = Date.now();
        // --- Global mass-arrival suppression (>2 distinct events in 3s) ---
        recentDetections.push(now);
        recentDetections = recentDetections.filter(t => now - t < 3000);
        if (config.suppressMassQuantumAlerts && recentDetections.length > 2) {
            isSuppressed = true;
            console.log(`[Main] Suppressing HUD alert for ${data.type} (mass arrival: ${recentDetections.length} events in 3s).`);
        }
        // --- Per-ship-name deduplication (same class within 4s) ---
        const shipKey = (data.ship || data.value || '').toLowerCase().split(/[_\s]/)[0]; // e.g. 'drak' from 'DRAK_Golem_OX'
        const fullShipKey = (data.ship || data.value || '').toLowerCase();
        const lastNotif = recentShipNotifications[fullShipKey] || 0;
        if (!isSuppressed && now - lastNotif < 4000) {
            isSuppressed = true;
            console.log(`[Main] Suppressing duplicate notification for same ship: ${data.ship || data.value} (last notif ${now - lastNotif}ms ago).`);
        }
        if (!isSuppressed) {
            recentShipNotifications[fullShipKey] = now;
        }
        // Prune old entries from the map every 30s to avoid memory leak
        if (Math.random() < 0.05) {
            for (const k of Object.keys(recentShipNotifications)) {
                if (now - recentShipNotifications[k] > 30000) delete recentShipNotifications[k];
            }
        }
    }

    if (data.type === 'RADAR_SINGLE' && config.quantumExitsOnly) {
        // Suppress HUD alerts entirely for normal radar detections in quantum-exits-only mode
        isSuppressed = true;
    }

    // Critical alerts → show alert window + tray notification
    if (gameActive && ['STATUS', 'ZONE', 'HAZARD_FIRE', 'DEATH', 'VEHICLE_DESTRUCTION', 'RADAR_SINGLE', 'PROXIMITY_DEATH'].includes(data.type)) {
        if (config.hudWarningsEnabled && !isSuppressed && alertWindow && !alertWindow.isDestroyed()) {
            alertWindow.show();
            alertWindow.webContents.send('alert:trigger', data);
        }

        if (data.type === 'STATUS') {
            console.log(`[Main] STATUS Event: "${data.value}" source:${data.source || 'unknown'}`);
            if (data.value === 'death') {
                if (config.enableDeathAlerts !== false) showTrayNotification('☠️ DEATH DETECTED', 'Your character has died.');
                LogWatcher.cachedState.ship = null;
                broadcast('gamestate', { type: 'SHIP_EXIT', value: null });
            } else if (data.value === 'suffocating') {
                if (config.enableStaminaOxygenAlerts !== false) showTrayNotification('🌡️ SUFFOCATING', 'Check your helmet seal!');
            }
        } else if (data.type === 'DEATH') {
            const killer = data.details?.killer || 'Unknown';
            if (config.enableDeathAlerts !== false) showTrayNotification('☠️ KILLED', `Killed by ${killer}`);
            LogWatcher.cachedState.ship = null;
            broadcast('gamestate', { type: 'SHIP_EXIT', value: null });
        } else if (data.type === 'HAZARD_FIRE') {
            if (config.enableFireAlerts !== false) showTrayNotification('🔥 FIRE', data.value || 'Fire detected on ship');
        } else if (data.type === 'PROXIMITY_DEATH') {
            const displayValue = data.value === 'Nearby Player' ? 'A player' : data.value;
            if (config.enableDeathAlerts !== false) {
                showTrayNotification('☠️ PROXIMITY KIA', `${displayValue} was eliminated nearby.`);
                if (data.value === 'Nearby Player') {
                    speak('Nearby player eliminated.');
                } else {
                    speak(`Proximity target ${data.value} eliminated.`);
                }
            }
        }
    }

    // ═══ HUD ALERTS (Phase 3) ═══
    if (gameActive && data.type === 'INTERDICTION') {
        if (config.hudWarningsEnabled && alertWindow && !alertWindow.isDestroyed()) {
            alertWindow.show();
            alertWindow.webContents.send('alert:trigger', { type: 'STATUS', value: 'interdiction' });
        }
        speak('Warning. Quantum interdiction detected.');
    }

    if (gameActive && data.type === 'TACTICAL_PROXIMITY') {
        const shipName = data.ship || 'Unknown';
        showTrayNotification('⚠️ TACTICAL ALERT', `Interdiction ship nearby: ${shipName}`);
        if (!isSuppressed) {
            speak(`Warning. ${shipName} detected nearby.`);
            if (config.hudWarningsEnabled && alertWindow && !alertWindow.isDestroyed()) {
                alertWindow.show();
                alertWindow.webContents.send('alert:trigger', { type: 'STATUS', value: 'tactical_proximity', ship: shipName });
            }
        }
    }

    // Quantum ship arrival (FinalStop=0 confirmed signal)
    if (gameActive && data.type === 'TACTICAL_QUANTUM' && data.direction === 'arrival') {
        const shipName = data.ship || 'Unknown Ship';
        if (!isSuppressed) {
            showTrayNotification('🌌 QUANTUM ARRIVAL', `${shipName} dropped out of quantum nearby`);
            speak(`Attention. ${shipName} arrived from quantum.`);
            if (config.hudWarningsEnabled && alertWindow && !alertWindow.isDestroyed()) {
                alertWindow.show();
                alertWindow.webContents.send('alert:trigger', { type: 'TACTICAL_QUANTUM', ship: shipName, value: data.value });
            }
        }
    }
    if (gameActive && data.type === 'VEHICLE_DEATH') {
        if (config.hudWarningsEnabled && alertWindow && !alertWindow.isDestroyed()) {
            alertWindow.show();
            alertWindow.webContents.send('alert:trigger', { type: 'STATUS', value: 'soft_death' });
        }
    }

    // Ship events - tray notification
    if (gameActive && data.type === 'SHIP_ENTER') {
        showTrayNotification('🚀 Ship Entered', `Boarded: ${data.value}`);
        if (dashboardWindow && !dashboardWindow.isDestroyed()) {
            dashboardWindow.webContents.send('settings:last-ship', data.value);
        }
    } else if (gameActive && data.type === 'SHIP_EXIT') {
        showTrayNotification('🚀 Ship Exited', `Left: ${data.value}`);
    }

    // ═══════════════════════════════════════════════════════
    // REACTION LOGIC (v2.8)
    // ═══════════════════════════════════════════════════════

    function handlePatternReactions(data) {
        if (!patternDatabase.patterns) return;

        // Only match USER-DEFINED patterns (not built-in ones from the Log Database)
        // Built-in patterns are for display/search only, not for triggering reactions
        const p = patternDatabase.patterns.find(x => x.event === data.type && x.source !== 'builtin');
        if (!p) return;

        // 1. Alert (Full Screen)
        if (p.alert && p.alert !== 'none') {
            if (alertWindow && !alertWindow.isDestroyed()) {
                alertWindow.show();
                alertWindow.webContents.send('alert:trigger', {
                    type: p.alert === 'audio' ? 'STATUS' : data.type, // Map to alert UI types
                    value: p.warning || data.value,
                    pattern: p
                });
            }
        }

        // 2. HUD Warning
        if (p.warning) {
            if (overlayWindow && !overlayWindow.isDestroyed()) {
                overlayWindow.webContents.send('log:update', {
                    type: 'HUD_WARNING',
                    value: p.warning,
                    level: 'WARNING'
                });
            }
        }

        // 3. Reaction (TTS or Command)
        if (p.reaction) {
            if (p.reaction.startsWith('TTS:')) {
                const text = p.reaction.replace('TTS:', '').trim();
                // We can send this to dashboard to play synthesized speech or use tray notification
                showTrayNotification('📢 Voice Reaction', text);
                if (dashboardWindow && !dashboardWindow.isDestroyed()) {
                    dashboardWindow.webContents.send('app:tts', text);
                }
            } else if (p.reaction.startsWith('/')) {
                // Future: Execute in-game command? For now, log it.
                console.log(`[Main] Reaction Command: ${p.reaction}`);
            }
        }
    }

    // ═══ SOCIAL (Phase 5) ═══
    if (data.type === 'SOCIAL_PROXIMITY') {
        // Just broadcast for now, maybe add to overlay later if needed
    }

    // API Party Updates are already handled via 'party:update' from APIClient
    // which emits 'party' event to Main. We need to forward that to Overlay.


    // Mission events (Legacy single event)
    if (data.type === 'MISSION') {
        const icons = { accepted: '📋', completed: '✅', failed: '❌' };
        showTrayNotification(`${icons[data.value] || '📋'} Mission ${data.value}`, data.detail || 'Mission update');
    }

    // ════════ NEW: Multi-Mission Tracking ════════
    if (['MISSION_ACCEPTED', 'MISSION_OBJECTIVE', 'MISSION_STATUS', 'MISSION_CHANGED'].includes(data.type)) {
        if (!config.activeMissions) config.activeMissions = {}; // ID -> { title, objective, status, tracked, timestamp }

        const id = data.id || 'unknown_' + Date.now();
        const now = Date.now();

        if (data.type === 'MISSION_ACCEPTED') {
            const title = data.value;
            let existingId = Object.keys(config.activeMissions).find(k => 
                config.activeMissions[k].status === 'active' && 
                config.activeMissions[k].title.toLowerCase().trim() === title.toLowerCase().trim()
            );

            const targetId = existingId || id;
            
            config.activeMissions[targetId] = {
                id: targetId,
                title: title,
                objective: config.activeMissions[targetId]?.objective || 'Pending objective...',
                status: 'active',
                tracked: true,
                timestamp: now
            };
            // Map notifId to missionId
            if (data.notifId) {
                if (!config.missionNotifMap) config.missionNotifMap = {};
                config.missionNotifMap[data.notifId] = targetId;
            }
            // Untrack others
            Object.values(config.activeMissions).forEach(m => { if (m.id !== targetId) m.tracked = false; });
            if (!existingId) {
                showTrayNotification('📋 Contract Accepted', title);
            }
        }
        else if (data.type === 'MISSION_OBJECTIVE') {
            let targetId = id;
            
            // Try resolving via sequential notification ID sequence!
            if (data.notifId && config.missionNotifMap) {
                let bestDiff = 999;
                let foundMissionId = null;
                Object.keys(config.missionNotifMap).forEach(acceptedNotifId => {
                    const diff = data.notifId - parseInt(acceptedNotifId);
                    if (diff >= 0 && diff < 10 && diff < bestDiff) {
                        bestDiff = diff;
                        foundMissionId = config.missionNotifMap[acceptedNotifId];
                    }
                });
                if (foundMissionId) {
                    targetId = foundMissionId;
                }
            }

            if (!config.activeMissions[targetId] || targetId.startsWith('unknown_')) {
                const active = Object.values(config.activeMissions)
                    .filter(m => m.status === 'active')
                    .sort((a, b) => b.timestamp - a.timestamp);
                if (active.length > 0) {
                    targetId = active[0].id;
                }
            }

            if (config.activeMissions[targetId]) {
                const currentObj = config.activeMissions[targetId].objective || '';
                const cleanNew = data.value.trim();
                
                if (currentObj === 'Pending objective...' || currentObj === '-') {
                    config.activeMissions[targetId].objective = cleanNew;
                } else {
                    const lines = currentObj.split('\n').map(l => l.trim());
                    if (!lines.includes(cleanNew)) {
                        config.activeMissions[targetId].objective = currentObj + '\n' + cleanNew;
                    }
                }
                config.activeMissions[targetId].timestamp = now;
            }
        }
        else if (data.type === 'MISSION_CHANGED') { // Tracking update
            if (config.activeMissions[id]) {
                Object.values(config.activeMissions).forEach(m => m.tracked = false);
                config.activeMissions[id].tracked = true;
                config.activeMissions[id].timestamp = now;
            }
        }
        else if (data.type === 'MISSION_STATUS') { // Completed/Failed
            let targetId = id;
            if (!config.activeMissions[targetId]) {
                const searchTitle = (data.title || data.value || '').toLowerCase().trim();
                if (searchTitle) {
                    const found = Object.values(config.activeMissions).find(m => {
                        const mTitle = (m.title || '').toLowerCase().trim();
                        return mTitle === searchTitle || mTitle.includes(searchTitle) || searchTitle.includes(mTitle);
                    });
                    if (found) {
                        targetId = found.id;
                    }
                }
            }

            if (config.activeMissions[targetId]) {
                config.activeMissions[targetId].status = data.value; // 'completed', 'failed'
                if (data.value === 'completed' || data.value === 'ended') {
                    config.activeMissions[targetId].status = 'completed';
                    if (config.enableMissionStatusAlerts !== false) showTrayNotification('✅ Contract Complete', config.activeMissions[targetId].title || 'Mission');
                } else if (data.value === 'failed') {
                    config.activeMissions[targetId].status = 'failed';
                    if (config.enableMissionStatusAlerts !== false) showTrayNotification('❌ Contract Failed', config.activeMissions[targetId].title || 'Mission');
                }
            }
        }


        saveConfig();
        broadcast('mission:list', Object.values(config.activeMissions));
    }

    // Insurance
    if (data.type === 'INSURANCE_CLAIM') {
        showTrayNotification('🛡️ Insurance Claim', data.value || 'Claim filed');
    }

    // Docking
    if (data.type === 'DOCKING') {
        showTrayNotification('🔗 Docking', data.value === 'granted' ? 'Docking granted!' : 'Docking requested');
    }

    // Game join/leave
    if (data.type === 'GAME_JOIN') {
        showTrayNotification('🎮 Game Joined', 'Connected to server');
    } else if (data.type === 'GAME_LEAVE' || data.type === 'GAME_RESTART') {
        const msg = data.type === 'GAME_LEAVE' ? 'Disconnected from server' : 'Game Client Restarted';
        showTrayNotification('🎮 Game Status', msg);

        // Clear ship state
        LogWatcher.cachedState.ship = null;
        broadcast('gamestate', { type: 'SHIP_EXIT', value: null });

        // ═══ MISSION CLEANUP ═══
        // Clear active missions on game exit/restart as they are session-based
        if (config.activeMissions && Object.keys(config.activeMissions).length > 0) {
            console.log('[Main] Clearing active missions on game exit.');
            config.activeMissions = {};
            config.currentMission = null;
            config.currentObjective = null;
            saveConfig();
            broadcast('mission:list', []);
        }
    }

    // Medical

    // Medical
    if (data.type === 'MEDICAL_BED') {
        showTrayNotification('🏥 Medical Bed', 'Entered medical bed');
    }
    if (data.type === 'SPAWN_SET') {
        showTrayNotification('📍 Spawn Point Set', data.value || 'New spawn location');
        // Persist spawn point
        config.spawnPoint = data.value;
        saveConfig();
        // Also update cached state in LogWatcher just in case
        LogWatcher.cachedState.spawn = data.value;
    }
    if (data.type === 'SHIP_ENTER') {
        LogWatcher.cachedState.ship = data.value;
    }

    // New Location Alert (Unmapped)
    if (data.type === 'NEW_LOCATION') {
        showTrayNotification('📍 New Location Detected', `${data.value || data.raw}\nClick to name it in the app.`);
    }

    // Custom Alerts (User Defined)
    if (data.type === 'CUSTOM') {
        showTrayNotification(data.message || 'Custom Alert', data.value);

        // Trigger Global Overlay Alert for WARNING/CRITICAL levels
        if (['CRITICAL', 'WARNING'].includes(data.level)) {
            if (alertWindow && !alertWindow.isDestroyed()) {
                alertWindow.show();
                alertWindow.webContents.send('alert:trigger', {
                    type: 'CUSTOM',
                    level: data.level,
                    message: data.message,
                    value: data.value
                });
            }
        }
    }

    // Death Detection & Squad Sync (v2.10.1)
    if (data.type === 'DEATH') {
        const victim = data.details?.victim;
        const myHandle = config.rsiHandle || 'Commander';
        
        // If victim matches us, or if it's a generic death event without specific victim (scented from <Actor Death>)
        if (!victim || victim.toLowerCase() === myHandle.toLowerCase()) {
            console.log('[Main] Player death detected in logs. Syncing 0% health to squad.');
            if (squadManager && config.shareHealth) {
                squadManager.shareHealth(0, LogWatcher.cachedState.location || 'Unknown');
            }
            // Also notify local dashboard to update its UI
            if (dashboardWindow && !dashboardWindow.isDestroyed()) {
                dashboardWindow.webContents.send('log:update', { type: 'DEATH', details: data.details });
            }
        }
    }

    // Mission Persistence
    if (data.type === 'MISSION_ACCEPTED') {
        // Init map if valid
        if (!config.missionMap) config.missionMap = {};

        // Store ID -> Title mapping
        if (data.id) {
            config.missionMap[data.id] = data.value;
        }

        config.currentMission = data.value;
        config.currentObjective = 'Started'; // Reset objective
        saveConfig();
        if (dashboardWindow) dashboardWindow.webContents.send('log:update', { type: 'MISSION_CURRENT', value: data.value });
    }

    // Handle switching tracked mission (via Marker ID)
    if (data.type === 'MISSION_CHANGED') {
        config.currentMission = data.value;
        saveConfig();
        if (dashboardWindow) dashboardWindow.webContents.send('log:update', { type: 'MISSION_CURRENT', value: data.value });
    }

    if (data.type === 'MISSION_OBJECTIVE') {
        config.currentObjective = data.value;
        saveConfig();
        if (dashboardWindow) dashboardWindow.webContents.send('log:update', { type: 'MISSION_OBJECTIVE', value: data.value });
    }
    if (data.type === 'SESSION_START') LogWatcher.cachedState.startTime = data.value;
    if (data.type === 'BUILD_INFO') LogWatcher.cachedState.build = data.value;
    if (data.type === 'HANGAR_STATE') {
        LogWatcher.cachedState.hangarState = data.value;
        LogWatcher.cachedState.hangarStartTime = Date.now();
        broadcast('gamestate', { type: 'HANGAR_STATE', value: data.value });
    }
    if (data.type === 'MISSION_STATUS' && (data.value === 'completed' || data.value === 'failed')) {
        if (data.id && config.missionMap) {
            delete config.missionMap[data.id];
        }

        // Only clear current mission if it matches the one completed (or if we don't have IDs to check)
        // If we don't have ID, assume it's current.
        let isCurrent = true;
        // Logic: if we have ID, check if it maps to current title? Hard to say without more state.
        // Simplest: Just clear current.
        config.currentMission = null;
        config.currentObjective = null;
        saveConfig();
        if (dashboardWindow) dashboardWindow.webContents.send('log:update', { type: 'MISSION_CLEARED' });
    }
});

LogWatcher.on('status', (status) => {
    logConnected = status.connected;
    updateTrayStatus(logConnected, apiConnected);
    broadcast('log:status', status);
});

LogWatcher.on('error', (err) => {
    console.error('[LogWatcher] Error:', err);
    broadcast('log:error', { message: typeof err === 'string' ? err : err.message || 'Unknown error' });
});

LogWatcher.on('login', (data) => {
    broadcast('log:update', { type: 'LOGIN', value: 'ONLINE', handle: data.handle });
    showTrayNotification('🎮 Star Citizen', `Logged in as ${data.handle || 'Pilot'}`);
});

// Unknown log lines
LogWatcher.on('unknown', (data) => {
    broadcast('log:unknown', data);
});

// API Events
APIClient.on('party', (data) => broadcast('api:party', data));
APIClient.on('status', (status) => {
    apiConnected = status.connected;
    updateTrayStatus(logConnected, apiConnected);
    broadcast('api:status', status);
});

// Command events from server
APIClient.on('command', (data) => {
    broadcast('command:receive', data);
    // Show alert for commands
    if (alertWindow && !alertWindow.isDestroyed()) {
        alertWindow.show();
        alertWindow.webContents.send('alert:trigger', { type: 'COMMAND', value: data });
    }
    showTrayNotification(`📢 ${data.from || 'Command'}`, data.text || data.preset || 'New order received');
});

// VerseCon platform events
APIClient.on('beacon', (data) => {
    broadcast('vcon:beacon', data);
    showTrayNotification('🆘 Beacon Alert', data.message || 'New beacon deployed');
});
APIClient.on('job', (data) => {
    broadcast('vcon:job', data);
    showTrayNotification('📜 Contract Available', data.message || 'New contract posted');
});

// v2.2 - Generic Notification Tunnel (Fixes missing toasts)
APIClient.on('notification', (data) => {
    // data = { title, message, type: 'info|success|warning|error' }
    console.log('[Main] Received Notification from API:', data);
    broadcast('vcon:notification', data);
    showTrayNotification(data.title || 'VerseCon Alert', data.message);
});

// ═══════════════════════════════════════════════════════
// IPC HANDLERS - CONFIG
// ═══════════════════════════════════════════════════════

ipcMain.handle('settings:get-ship-map', async () => {
    return config.shipMap;
});

ipcMain.handle('settings:save-ship-map', async (event, map) => {
    config.shipMap = map;
    saveConfig();
    LogWatcher.setShipMap(map);
    return true;
});

ipcMain.handle('settings:get-custom-patterns', async () => config.customPatterns);

// Log Persistence & Pattern Export
const LogEngine = require('./parsers');

ipcMain.handle('settings:get-default-patterns', async () => {
    // 1. Get Legacy Patterns
    const defaults = {};
    const legacyPatterns = LogWatcher.constructor.DEFAULT_PATTERNS || {};
    for (const [key, regex] of Object.entries(legacyPatterns)) {
        defaults[key] = regex.source;
    }

    // 2. Get Modular Parser Patterns
    // LogEngine exposes .parsers array (which contains registered instances)
    if (LogEngine.parsers) {
        for (const parser of LogEngine.parsers) {
            if (parser.patterns) {
                for (const [key, regex] of Object.entries(parser.patterns)) {
                    // Avoid overwriting if key conflict (or maybe prefix?)
                    // Let's assume unique keys for now, or last-one-wins (which is fine, modular is newer).

                    // Do not return patterns that have been soft-deleted by the user
                    const isDeleted = config.patternOverrides && config.patternOverrides[key] && config.patternOverrides[key].deleted;

                    if (regex instanceof RegExp && !isDeleted) {
                        defaults[key] = regex.source;
                    }
                }
            }
        }
    }

    return defaults;
});

ipcMain.handle('settings:get-pattern-overrides', async () => config.patternOverrides || {});

ipcMain.handle('settings:save-pattern-overrides', async (event, overrides) => {
    console.log('[Main] Saving pattern overrides:', JSON.stringify(overrides));
    config.patternOverrides = overrides;
    saveConfig();
    LogWatcher.setPatternOverrides(overrides);
    return true;
});

ipcMain.handle('settings:save-custom-patterns', async (event, patterns) => {
    config.customPatterns = patterns;
    saveConfig();
    updateUnifiedPatterns();
    return true;
});

// ═══════════════════════════════════════════════════════
// NEW HANDLERS (v2.5 Fixes)
// ═══════════════════════════════════════════════════════

ipcMain.on('mission:dismiss', (event, id) => {
    if (config.activeMissions && config.activeMissions[id]) {
        console.log('[Main] Dismissing mission:', id);
        delete config.activeMissions[id];

        // If it was the current mission, clear that too
        if (config.currentMission === config.missionMap?.[id]) {
            config.currentMission = null;
            config.currentObjective = null;
        }

        saveConfig();
        broadcast('mission:list', Object.values(config.activeMissions));
    }
});

ipcMain.handle('settings:get-custom-locations', async () => {
    return config.customLocations || {};
});

ipcMain.handle('settings:save-custom-locations', async (event, locations) => {
    console.log('[Main] Saving custom locations:', locations);
    config.customLocations = locations;
    saveConfig();
    
    // Merge with bundled locations to keep navigation parser up-to-date locally
    let merged = {};
    const bundledLocPath = path.join(__dirname, '..', '..', 'data', 'locations.json');
    try {
        if (fs.existsSync(bundledLocPath)) {
            merged = JSON.parse(fs.readFileSync(bundledLocPath, 'utf-8'));
        }
    } catch (e) {}
    merged = { ...merged, ...locations };
    NavigationParser.setCustomLocations(merged);
    
    broadcast('settings:custom-locations-updated', locations);
    return true;
});

ipcMain.handle('settings:export-custom-locations', async () => {
    try {
        const locations = config.customLocations || {};
        const devLocPath = path.join(__dirname, '..', '..', 'data', 'locations.json');
        
        // Write to dev locations
        fs.mkdirSync(path.dirname(devLocPath), { recursive: true });
        fs.writeFileSync(devLocPath, JSON.stringify(locations, null, 2), 'utf-8');
        
        // Also check if public directory exists and write there
        let publicWritten = false;
        const publicLocPath = path.join(__dirname, '..', '..', '..', 'versecon-link-public', 'data', 'locations.json');
        if (fs.existsSync(path.dirname(path.dirname(publicLocPath)))) {
            fs.mkdirSync(path.dirname(publicLocPath), { recursive: true });
            fs.writeFileSync(publicLocPath, JSON.stringify(locations, null, 2), 'utf-8');
            publicWritten = true;
        }
        
        return { success: true, count: Object.keys(locations).length, publicWritten };
    } catch (e) {
        console.error('[Main] Export locations error:', e);
        return { success: false, error: e.message };
    }
});

let hueRestoreTimers = {};

async function triggerHueAlert(color) {
    if (!config.hueEnabled || !config.hueBridge || !config.hueUser) return;
    const states = {
        red: { on: true, hue: 0, sat: 254, bri: 254, alert: 'lselect' },
        orange: { on: true, hue: 10000, sat: 254, bri: 200, alert: 'select' },
        blue: { on: true, hue: 45000, sat: 254, bri: 150 },
        green: { on: true, hue: 25000, sat: 254, bri: 150 },
        white: { on: true, hue: 0, sat: 0, bri: 254 },
        off: { on: false }
    };
    const state = states[color] || states.white;
    const baseUrl = `http://${config.hueBridge}/api/${config.hueUser}/lights`;

    try {
        await Promise.all(config.hueLights.map(async id => {
            // Cancel any pending restores for this light
            if (hueRestoreTimers[id]) {
                clearTimeout(hueRestoreTimers[id]);
            }

            // 1. Fetch current state before alerting
            let originalState = null;
            try {
                const res = await fetch(`${baseUrl}/${id}`);
                const data = await res.json();
                if (data && data.state) {
                    originalState = {
                        on: data.state.on,
                        bri: data.state.bri,
                        hue: data.state.hue,
                        sat: data.state.sat,
                        ct: data.state.ct,
                        xy: data.state.xy
                    };
                }
            } catch (err) {
                console.warn(`[Hue] Failed to fetch state for light ${id}:`, err.message);
            }

            // 2. Apply alert state
            await fetch(`${baseUrl}/${id}/state`, {
                method: 'PUT',
                body: JSON.stringify(state)
            });

            // 3. Schedule restore if we captured original state
            if (originalState) {
                hueRestoreTimers[id] = setTimeout(async () => {
                    try {
                        // Clear the 'alert' effect first if it was set
                        if (state.alert) {
                            await fetch(`${baseUrl}/${id}/state`, {
                                method: 'PUT',
                                body: JSON.stringify({ alert: 'none' })
                            });
                        }
                        // Restore previous config
                        await fetch(`${baseUrl}/${id}/state`, {
                            method: 'PUT',
                            body: JSON.stringify(originalState)
                        });
                        console.log(`[Hue] Restored state for light ${id}`);
                    } catch (err) {
                        console.error(`[Hue] Failed to restore light ${id}:`, err.message);
                    }
                }, 5000); // Revert after 5 seconds
            }
        }));
    } catch (e) { console.error('[Hue] Trigger Failed:', e.message); }
}

function handleHueSituation(data) {
    // Priority: Use the color defined in the pattern match
    if (data.hueColor) {
        triggerHueAlert(data.hueColor);
        return;
    }

    // Fallback: Hardcoded situational defaults
    if (['HAZARD_FIRE', 'VEHICLE_DESTRUCTION', 'DEATH'].includes(data.type)) {
        triggerHueAlert('red');
    } else if (data.type === 'STATUS' && ['suffocating', 'interdiction'].includes(data.value)) {
        triggerHueAlert('red');
    } else if (data.type === 'INTERDICTION') {
        triggerHueAlert('orange');
    } else if (data.type === 'MISSION' && data.value === 'accepted') {
        triggerHueAlert('blue');
    }
}

// ═══════════════════════════════════════════════════════
// REMOTE CONTROL SERVER (v2.9)
// ═══════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════
// TACTICAL NETWORKING (v2.9)
// ═══════════════════════════════════════════════════════
const os = require('os');

function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

ipcMain.on('p2p:signal', (event, { toHandle, signal }) => {
    APIClient.sendSignal(toHandle, signal);
});

function startRemoteServer() {
    remoteApp = express();
    remoteApp.use(express.json());
    remoteApp.use(express.static(path.join(__dirname, '../renderer')));

    remoteApp.get('/api/remote/status', (req, res) => {
        res.json({ online: true, app: 'VerseCon Link', version: '2.9' });
    });

    remoteApp.post('/api/control/command', (req, res) => {
        const { preset, target, text, broadcast: shouldBroadcast } = req.body;
        const data = {
            preset,
            text,
            target: target || 'ALL',
            fromTeam: config.userTeam || 'Alpha',
            broadcast: !!shouldBroadcast,
            timestamp: Date.now()
        };
        ipcMain.emit('command:send', null, data); // Internally trigger
        if (dashboardWindow) dashboardWindow.webContents.send('command:external', data);
        res.json({ success: true });
    });

    remoteApp.post('/api/control/vfx', (req, res) => {
        const { type } = req.body;
        broadcast('alert:trigger', { type: 'STATUS', value: type });
        res.json({ success: true });
    });

    // ═══ STREAM DECK API ENDPOINTS (v2.10) ═══
    remoteApp.post('/api/streamdeck/send-command', express.json(), (req, res) => {
        const { preset, target } = req.body;
        if (!preset || !target) {
            return res.status(400).json({ error: 'Missing preset or target' });
        }
        // Broadcast command to overlay/dashboard
        broadcast('command:receive', { preset, target, from: 'STREAM_DECK' });
        if (dashboardWindow && !dashboardWindow.isDestroyed()) {
            dashboardWindow.webContents.send('command:receive', { preset, target, from: 'STREAM_DECK' });
        }
        res.json({ success: true, command: preset, target });
    });

    remoteApp.post('/api/streamdeck/tts', express.json(), (req, res) => {
        const { text } = req.body;
        if (!text) return res.status(400).json({ error: 'Missing text' });
        // Send TTS to dashboard
        if (dashboardWindow && !dashboardWindow.isDestroyed()) {
            dashboardWindow.webContents.send('app:tts', text);
        }
        res.json({ success: true, text });
    });

    remoteApp.post('/api/streamdeck/visual-alert', express.json(), (req, res) => {
        const { type, duration } = req.body;
        if (!type) return res.status(400).json({ error: 'Missing type' });
        // Send visual alert
        broadcast('vfx:alert', { type: type, duration: duration || 3000 });
        res.json({ success: true, alert: type });
    });

    remoteApp.get('/api/streamdeck/status', (req, res) => {
        res.json({
            connected: dashboardWindow && !dashboardWindow.isDestroyed(),
            version: '2.10',
            mode: 'production'
        });
    });

    remoteApp.get('/api/streamdeck/buttons', (req, res) => {
        res.json({
            buttons: [
                {
                    name: "RTB",
                    endpoint: "POST /api/streamdeck/send-command",
                    body: { "preset": "RTB", "target": "ALL" }
                },
                {
                    name: "Defend",
                    endpoint: "POST /api/streamdeck/send-command",
                    body: { "preset": "DEFEND", "target": "ALL" }
                },
                {
                    name: "Engage",
                    endpoint: "POST /api/streamdeck/send-command",
                    body: { "preset": "ENGAGE", "target": "ALL" }
                },
                {
                    name: "EMERGENCY SOS",
                    endpoint: "POST /api/streamdeck/send-command",
                    body: { "preset": "EMERGENCY", "target": "ALL" }
                },
                {
                    name: "Text To Speech",
                    endpoint: "POST /api/streamdeck/tts",
                    body: { "text": "custom message here" }
                },
                {
                    name: "Visual Alert",
                    endpoint: "POST /api/streamdeck/visual-alert",
                    body: { "type": "interdiction", "duration": 3000 }
                },
                {
                    name: "Status Check",
                    endpoint: "GET /api/streamdeck/status",
                    body: null
                }
            ],
            baseUrl: "http://[your-machine-ip]:4400"
        });
    });

    remoteServer = http.createServer(remoteApp);
    remoteServer.listen(4400, '0.0.0.0', () => {
        console.log('[Remote] Server active on port 4400');
    });
}

// ═══════════════════════════════════════════════════════
// LOG PATTERN DATABASE (v2.7)
// ═══════════════════════════════════════════════════════
const PATTERNS_DB_PATH = path.join(app.getPath('userData'), 'known-patterns.json');
const BUNDLED_PATTERNS_PATH = path.join(__dirname, '../../known-patterns.json');

function loadPatternDB() {
    try {
        // Priority: user-data copy > bundled copy
        const dbPath = fs.existsSync(PATTERNS_DB_PATH) ? PATTERNS_DB_PATH : BUNDLED_PATTERNS_PATH;
        if (fs.existsSync(dbPath)) {
            return JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
        }
    } catch (e) {
        console.error('[Main] Failed to load pattern DB:', e);
    }
    return { _meta: { version: '1.0.0', lastUpdated: new Date().toISOString().split('T')[0] }, patterns: [] };
}

/**
 * Extract all built-in regex patterns from the registered parsers so they appear
 * in the Log Database for browsing, searching, and exporting.
 */
function getBuiltinPatterns() {
    const parserDir = path.join(__dirname, 'parsers');
    const parserFiles = ['navigation', 'session', 'hangar', 'vehicle', 'inventory', 'combat', 'mission', 'economy', 'social'];

    const categoryMap = {
        navigation: 'Navigation', session: 'Session', hangar: 'Vehicle',
        vehicle: 'Vehicle', inventory: 'Inventory', combat: 'Combat',
        mission: 'Mission', economy: 'Economy', social: 'Social'
    };

    const builtins = [];

    // Default effect assignments for built-in patterns
    const effectDefaults = {
        // Combat - Critical
        death: { hue: 'red', overlay: 'both', alert: 'both', warning: 'KILLED' },
        kill_player: { hue: 'orange', overlay: 'alert', alert: 'visual' },
        kill_npc: { hue: 'none', overlay: 'feed', alert: 'none' },
        vehicle_destruction: { hue: 'red', overlay: 'alert', alert: 'visual', warning: 'VEHICLE DESTROYED' },
        vehicle_destruction_detail: { hue: 'red', overlay: 'both', alert: 'both', warning: 'SHIP DESTROYED' },
        crimestat: { hue: 'orange', overlay: 'alert', alert: 'visual', warning: 'CRIMESTAT' },
        crimestat_cleared: { hue: 'green', overlay: 'feed', alert: 'none' },
        // Hazards
        suffocating: { hue: 'red', overlay: 'alert', alert: 'visual', warning: 'SUFFOCATING' },
        depressurizing: { hue: 'red', overlay: 'alert', alert: 'visual', warning: 'DEPRESSURIZING' },
        fire_actual: { hue: 'red', overlay: 'alert', alert: 'both', warning: 'FIRE ONBOARD' },
        fire_ship_init: { hue: 'orange', overlay: 'alert', alert: 'visual', warning: 'FIRE DETECTED' },
        fire_notification: { hue: 'orange', overlay: 'feed', alert: 'none' },
        // Navigation
        location: { hue: 'none', overlay: 'feed', alert: 'none' },
        location_hint: { hue: 'none', overlay: 'feed', alert: 'none' },
        quantum_travel: { hue: 'none', overlay: 'feed', alert: 'none' },
        interdiction: { hue: 'orange', overlay: 'alert', alert: 'visual', warning: 'INTERDICTION' },
        // Vehicle
        ship_enter: { hue: 'none', overlay: 'feed', alert: 'none' },
        ship_current: { hue: 'none', overlay: 'feed', alert: 'none' },
        landing_pad: { hue: 'none', overlay: 'feed', alert: 'none' },
        // Session
        login: { hue: 'none', overlay: 'feed', alert: 'none' },
        server_connect: { hue: 'none', overlay: 'feed', alert: 'none' },
        server_region: { hue: 'none', overlay: 'feed', alert: 'none' },
        loading_screen: { hue: 'blue', overlay: 'feed', alert: 'none' },
        // Economy
        shop_browse: { hue: 'none', overlay: 'feed', alert: 'none' },
        insurance_claim: { hue: 'none', overlay: 'feed', alert: 'none' },
        // Mission
        mission_accepted: { hue: 'blue', overlay: 'feed', alert: 'none' },
        mission_completed: { hue: 'green', overlay: 'feed', alert: 'none' },
        mission_failed: { hue: 'red', overlay: 'feed', alert: 'none' },
        // Social
        friend_join: { hue: 'none', overlay: 'feed', alert: 'none' },
        proximity: { hue: 'none', overlay: 'feed', alert: 'none' },
    };

    for (const file of parserFiles) {
        try {
            const parser = require(path.join(parserDir, file));
            const cat = categoryMap[file] || 'Other';

            // Handle parsers with a `patterns` object
            if (parser.patterns) {
                for (const [key, regex] of Object.entries(parser.patterns)) {
                    const defaults = effectDefaults[key] || {};
                    builtins.push({
                        id: `builtin_${file}_${key}`,
                        name: `${key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`,
                        category: cat,
                        event: key.toUpperCase(),
                        regex: regex.toString(),
                        status: 'verified',
                        source: 'builtin',
                        hue: defaults.hue || 'none',
                        overlay: defaults.overlay || 'none',
                        alert: defaults.alert || 'none',
                        warning: defaults.warning || '',
                        notes: `Built-in pattern from ${file}.js parser`,
                        example: '',
                        addedBy: 'system',
                        addedDate: '2026-02-20'
                    });
                }
            }

            // Handle parsers with a single `pattern` property (e.g., inventory)
            if (parser.pattern) {
                builtins.push({
                    id: `builtin_${file}_main`,
                    name: `${file.charAt(0).toUpperCase() + file.slice(1)} Main Pattern`,
                    category: cat,
                    event: file.toUpperCase(),
                    regex: parser.pattern.toString(),
                    status: 'verified',
                    source: 'builtin',
                    notes: `Primary pattern from ${file}.js parser`,
                    example: '',
                    addedBy: 'system',
                    addedDate: '2026-02-20'
                });
            }

            // Handle parsers with inventoryPattern (e.g., inventory)
            if (parser.inventoryPattern) {
                builtins.push({
                    id: `builtin_${file}_inventory_mgmt`,
                    name: 'Inventory Management',
                    category: 'Inventory',
                    event: 'INVENTORY',
                    regex: parser.inventoryPattern.toString(),
                    status: 'verified',
                    source: 'builtin',
                    notes: `Inventory management pattern from ${file}.js parser`,
                    example: '',
                    addedBy: 'system',
                    addedDate: '2026-02-20'
                });
            }
        } catch (e) {
            console.warn(`[Main] Could not extract patterns from ${file}.js:`, e.message);
        }
    }
    return builtins;
}

function updateUnifiedPatterns() {
    const db = loadPatternDB();
    patternDatabase = db; // Sync global state

    // Filter out built-in patterns from the matching set to prevent double-processing.
    // Dedicated parsers (Combat, Vehicle, etc.) already handle these.
    // CustomParser should only handle TRUE custom patterns and unique DB entries.
    const builtins = getBuiltinPatterns().map(b => b.regex.toString());

    const dbPatterns = (db.patterns || []).filter(p => {
        // Skip if explicitly marked "NONE" as per our recent custom.js update
        if (p.event === 'NONE') return false;
        // Skip if this regex is already covered by a hardcoded builtin parser
        const reStr = new RegExp(p.regex, 'i').toString();
        return !builtins.includes(reStr);
    });

    const unifiedPatterns = [
        ...(config.customPatterns || []),
        ...dbPatterns
    ];

    LogWatcher.setCustomPatterns(unifiedPatterns);
    console.log('[Main] Unified matching patterns updated:', unifiedPatterns.length);
}

function savePatternDB(db) {
    try {
        db._meta.lastUpdated = new Date().toISOString().split('T')[0];
        fs.writeFileSync(PATTERNS_DB_PATH, JSON.stringify(db, null, 2));
        console.log('[Main] Pattern DB saved:', db.patterns.length, 'patterns');
    } catch (e) {
        console.error('[Main] Failed to save pattern DB:', e);
    }
}

ipcMain.handle('patterns:load', async () => {
    const db = loadPatternDB();

    // Inject built-in parser patterns so they appear in the Log Database for search and export
    const builtinPatterns = getBuiltinPatterns();
    const userIds = new Set(db.patterns.map(p => p.id));

    // Prepend built-in patterns that aren't already in the user DB
    for (const bp of builtinPatterns) {
        if (!userIds.has(bp.id)) {
            db.patterns.unshift(bp);
        }
    }

    return db;
});

ipcMain.handle('patterns:save', async (event, db) => {
    savePatternDB(db);
    return true;
});

ipcMain.handle('patterns:add', async (event, pattern) => {
    const db = loadPatternDB();
    pattern.id = pattern.id || `pattern_${Date.now()}`;
    pattern.addedDate = pattern.addedDate || new Date().toISOString().split('T')[0];
    pattern.addedBy = pattern.addedBy || 'user';
    db.patterns.push(pattern);
    savePatternDB(db);
    updateUnifiedPatterns();
    return db;
});

ipcMain.handle('patterns:update', async (event, patternId, updates) => {
    const db = loadPatternDB();
    const idx = db.patterns.findIndex(p => p.id === patternId);
    if (idx !== -1) {
        db.patterns[idx] = { ...db.patterns[idx], ...updates };
        savePatternDB(db);
        updateUnifiedPatterns();
    }
    return db;
});

ipcMain.handle('overlay:save-positions', (event, positions) => {
    config.overlayPositions = { ...config.overlayPositions, ...positions };
    saveConfig();
    return true;
});

ipcMain.handle('overlay:get-positions', () => {
    return config.overlayPositions || {};
});

ipcMain.handle('patterns:delete', async (event, patternId) => {
    const db = loadPatternDB();
    db.patterns = db.patterns.filter(p => p.id !== patternId);
    savePatternDB(db);
    updateUnifiedPatterns();
    return db;
});

ipcMain.handle('patterns:export', async () => {
    const db = loadPatternDB();

    // Merge built-in patterns so export includes everything
    const builtinPatterns = getBuiltinPatterns();
    const userIds = new Set(db.patterns.map(p => p.id));
    for (const bp of builtinPatterns) {
        if (!userIds.has(bp.id)) {
            db.patterns.unshift(bp);
        }
    }

    const result = await dialog.showSaveDialog(dashboardWindow, {
        title: 'Export Pattern Database',
        defaultPath: `versecon-patterns-${db._meta.lastUpdated}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (!result.canceled && result.filePath) {
        fs.writeFileSync(result.filePath, JSON.stringify(db, null, 2));
        return result.filePath;
    }
    return null;
});

ipcMain.handle('patterns:import', async () => {
    const result = await dialog.showOpenDialog(dashboardWindow, {
        title: 'Import Pattern Database',
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['openFile']
    });
    if (!result.canceled && result.filePaths[0]) {
        try {
            const imported = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf-8'));
            if (imported.patterns && Array.isArray(imported.patterns)) {
                const db = loadPatternDB();
                // Merge: add new patterns, skip duplicates by ID
                const existingIds = new Set(db.patterns.map(p => p.id));
                let added = 0;
                for (const p of imported.patterns) {
                    if (!existingIds.has(p.id)) {
                        db.patterns.push(p);
                        added++;
                    }
                }
                savePatternDB(db);
                return { success: true, added, total: db.patterns.length };
            }
        } catch (e) {
            return { success: false, error: e.message };
        }
    }
    return null;
});

// ═══════════════════════════════════════════════════════
// APP LIFECYCLE
// ═══════════════════════════════════════════════════════

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        if (dashboardWindow) {
            if (dashboardWindow.isMinimized()) dashboardWindow.restore();
            dashboardWindow.show();
            dashboardWindow.focus();
        }

        const url = commandLine.find(arg => arg.startsWith('versecon-link://'));
        if (url) handleDeepLink(url);
    });

    ipcMain.handle('hue:discover', async () => {
        try {
            const resp = await fetch('https://discovery.meethue.com');
            return await resp.json();
        } catch (e) {
            console.error('[Hue] Discovery Error:', e.message);
            return [];
        }
    });

    ipcMain.handle('hue:link', async (event, bridgeIp) => {
        try {
            const resp = await fetch(`http://${bridgeIp}/api`, {
                method: 'POST',
                body: JSON.stringify({ devicetype: 'versecon_link#pc' })
            });
            const data = await resp.json();
            return data; // Expected: [{ success: { username: "..." } }]
        } catch (e) {
            console.error('[Hue] Link Error:', e.message);
            return { error: e.message };
        }
    });

    ipcMain.handle('hue:get-ip', async () => {
        return getLocalIP();
    });

    ipcMain.handle('hue:control', async (event, { bridgeIp, username, lightId, state }) => {
        const lightIds = Array.isArray(lightId) ? lightId : [lightId];
        try {
            const results = await Promise.all(lightIds.map(async (id) => {
                const resp = await fetch(`http://${bridgeIp}/api/${username}/lights/${id}/state`, {
                    method: 'PUT',
                    body: JSON.stringify(state)
                });
                return await resp.json();
            }));
            return results;
        } catch (e) {
            console.error('[Hue] Control Error:', e.message);
            return { error: e.message };
        }
    });

    ipcMain.on('overlay:unlock', (event, unlock) => {
        const isIgnore = !unlock;
        if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.setIgnoreMouseEvents(isIgnore, { forward: true });
            overlayWindow.webContents.send('overlay:unlock', unlock);
        }
        if (squadHudWindow && !squadHudWindow.isDestroyed()) {
            squadHudWindow.setIgnoreMouseEvents(isIgnore, { forward: true });
        }
        if (netProximityHudWindow && !netProximityHudWindow.isDestroyed()) {
            netProximityHudWindow.setIgnoreMouseEvents(isIgnore, { forward: true });
        }
    });


    app.whenReady().then(() => {
        loadConfig(); // Load saved config
        patternDatabase = loadPatternDB(); // Load pattern DB
        
        // Init Squad Sync (v2.8)
        squadManager = new SquadManager();

        // Initialize NavigationParser with custom locations AFTER config is loaded
        let locations = {};
        const bundledLocPath = path.join(__dirname, '..', '..', 'data', 'locations.json');
        try {
            if (fs.existsSync(bundledLocPath)) {
                locations = JSON.parse(fs.readFileSync(bundledLocPath, 'utf-8'));
            }
        } catch (e) {
            console.error('[Main] Failed to load bundled locations:', e.message);
        }
        
        if (config.customLocations) {
            locations = { ...locations, ...config.customLocations };
        }
        NavigationParser.setCustomLocations(locations);

        LogWatcher.setShipMap(config.shipMap); // Apply saved map
        try {
            require('./parsers/combat').setRsiHandle(config.rsiHandle);
            require('./parsers/social').setRsiHandle(config.rsiHandle);
            require('./parsers/navigation').setRsiHandle(config.rsiHandle);
            require('./parsers/inventory').setRsiHandle(config.rsiHandle);
            if (config.rsiId) {
                require('./parsers/social').setRsiId(config.rsiId);
            }
            // Propagate interdiction and AI filtering options on load
            const logEngine = require('./parsers');
            if (logEngine) {
                if (config.interdictionShips) logEngine.setInterdictionShips(config.interdictionShips);
                if (config.interdictionQuantumOnly !== undefined) logEngine.setInterdictionQuantumOnly(config.interdictionQuantumOnly);
                if (config.filterAIShips !== undefined) logEngine.setFilterAIShips(config.filterAIShips);
            }
        } catch (e) {
            console.warn('[Main] Could not set RSI handle/ID or config on parsers:', e.message);
        }

        // Only send user-defined custom patterns to the CustomParser
        // Built-in patterns from getBuiltinPatterns() are for Log Database display only
        const userPatterns = (config.customPatterns || []).filter(p => p.source !== 'builtin');
        LogWatcher.setCustomPatterns(userPatterns);

        createWindows();
        createTray();

        // Sync state again after initial log scan is complete (v2.10.4)
        LogWatcher.on('initial-scan-complete', () => {
            console.log('[Main] Initial log scan complete, re-syncing state to windows.');
            LogWatcher.emitCurrentState();
            // Also force-set the status indicator in the sidebar
            if (dashboardWindow && !dashboardWindow.isDestroyed() && LogWatcher.isWatching) {
                const js = 'try {' +
                    'var dot = document.getElementById("status-log-dot");' +
                    'var txt = document.getElementById("status-log-text");' +
                    'if (dot) dot.className = "dot on";' +
                    'if (txt) txt.innerText = "Active";' +
                    '} catch(e) {}';
                dashboardWindow.webContents.executeJavaScript(js).catch(() => {});
            }
        });

        // ════ SQUAD HUD TELEMETRY (v2.8) ═══
        setInterval(async () => {
            if (apiConnected) {
                try {
                    const friends = await APIClient.fetchFriendList();
                    broadcast('api:friends', friends);
                } catch (e) {
                    console.error('[Main] Squad Telemetry Error:', e.message);
                }
            }
        }, 30000); // Pulse every 30s

        // Fix: Auto-load saved log path if available
        // v2.9 - Send Local IP for Remote pairing
        setTimeout(() => {
            const ip = getLocalIP();
            if (dashboardWindow) dashboardWindow.webContents.send('hue:ip', ip);
        }, 3000);

        // FIX 1: Ensure log path is set and valid
        if (!config.logPath) {
            console.warn('[Main] No logPath in config, attempting auto-detection');
            // Try to auto-detect
            const autoPath = LogWatcher.findLogFile();
            if (autoPath) {
                console.log('[Main] Auto-detected log path:', autoPath);
                config.logPath = autoPath;
                saveConfig();
            } else {
                console.error('[Main] Failed to auto-detect Game.log');
            }
        }

        if (config.logPath) {
            console.log('[Main] Starting LogWatcher with path:', config.logPath);
            LogWatcher.initialScanLimit = config.initialScanLimit || 5000;
            if (!fs.existsSync(config.logPath)) {
                console.error('[Main] LogPath does not exist:', config.logPath);
                console.log('[Main] Attempting to find alternate location...');
                const altPath = LogWatcher.findLogFile();
                if (altPath) {
                    config.logPath = altPath;
                    saveConfig();
                    console.log('[Main] Using alternate path:', altPath);
                }
            }
            LogWatcher.start(config.logPath);
        } else {
            console.error('[Main] No Game.log path available. User must manually select via Settings.');
            broadcast('log:error', { message: 'Game.log not found. Please select manually in Settings.' });
        }

        // Ensure status is broadcast to dashboard after start
        setTimeout(() => {
            const logStatus = { connected: LogWatcher.isWatching, path: LogWatcher.filePath };
            console.log('[Main] Broadcasting initial log status:', logStatus);
            broadcast('log:status', logStatus);
        }, 500);

        // FIX 4: Periodic check that log file still exists (every 30 seconds)
        setInterval(() => {
            if (config.logPath && !fs.existsSync(config.logPath)) {
                console.warn('[Main] Log file no longer exists at:', config.logPath);
                LogWatcher.stop();

                // Try to find new location
                const newPath = LogWatcher.findLogFile();
                if (newPath && newPath !== config.logPath) {
                    console.log('[Main] Found log file at new location:', newPath);
                    config.logPath = newPath;
                    saveConfig();
                    LogWatcher.start(newPath);
                    broadcast('log:status', { connected: true, path: newPath });
                } else if (!fs.existsSync(config.logPath)) {
                    broadcast('log:status', { connected: false, message: 'Game.log path no longer valid. Please re-select in Settings.' });
                    broadcast('log:error', { message: 'Game.log not found. Please re-select in Settings.' });
                }
            }
        }, 30000); // Check every 30 seconds

        // v2.2 - "Zero-Touch" Local Auth Check
        try {
            const tokenPath = path.join(app.getPath('home'), '.versecon-token');
            if (fs.existsSync(tokenPath)) {
                const token = fs.readFileSync(tokenPath, 'utf8').trim();
                if (token) {
                    console.log('[Main] Found local token file, auto-authenticating...');
                    // Slight delay to ensure window is ready
                    setTimeout(() => {
                        if (dashboardWindow) dashboardWindow.webContents.send('auth:success', token);
                        APIClient.token = token;
                        APIClient.connectSocket(token);
                        if (config.friendCode) APIClient.registerFriendCode(config.friendCode);
                    }, 2000);
                }
            }
        } catch (e) {
            console.error('[Main] Local token check failed:', e);
        }
    });

    app.on('open-url', (event, url) => {
        event.preventDefault();
        handleDeepLink(url);
    });
}

function handleDeepLink(url) {
    console.log('[Main] Received Deep Link:', url);
    try {
        const urlObj = new URL(url);
        const token = urlObj.searchParams.get('token');
        if (token) {
            console.log('[Main] Token found in URL');
            if (dashboardWindow) dashboardWindow.webContents.send('auth:success', token);
            APIClient.token = token;
            APIClient.connectSocket(token);
        }
    } catch (e) {
        console.error('[Main] Deep link parse error:', e);
    }
}

app.on('before-quit', () => {
    isQuitting = true;
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// Register as default protocol client
if (process.defaultApp) {
    if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient('versecon-link', process.execPath, [path.resolve(process.argv[1])]);
    }
} else {
    app.setAsDefaultProtocolClient('versecon-link');
}
// ═══ CNC OVERLAY LOGIC (v2.8) ═══
function createCncWindow() {
    if (cncWindow && !cncWindow.isDestroyed()) {
        cncWindow.focus();
        return;
    }

    cncWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        frame: false,
        backgroundColor: '#000000',
        title: 'VerseCon Command & Control',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    cncWindow.setMenuBarVisibility(false);
    cncWindow.loadFile(path.join(__dirname, '../renderer/cnc.html'));

    cncWindow.on('closed', () => { cncWindow = null; });
}

ipcMain.on('cnc:open', () => createCncWindow());

ipcMain.on('squad:host', () => {
    if (squadManager) squadManager.host();
});

ipcMain.on('squad:join', (event, hostIp) => {
    if (squadManager) squadManager.join(hostIp);
});

ipcMain.on('squad:stop', () => {
    if (squadManager) squadManager.stop();
});

ipcMain.on('app:share-health', (event, { health, location }) => {
    if (squadManager && config.shareHealth) {
        squadManager.shareHealth(health, location);
    }
});

// ═══ SQUAD HUD LOGIC (v2.8) ═══
function createSquadHudWindow() {
    if (squadHudWindow && !squadHudWindow.isDestroyed()) {
        squadHudWindow.focus();
        return;
    }

    squadHudWindow = new BrowserWindow({
        width: 320,
        height: 600,
        x: 20, // Far left
        y: 100,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        alwaysOnTop: true,
        resizable: true,
        skipTaskbar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    squadHudWindow.setIgnoreMouseEvents(true, { forward: true });
    squadHudWindow.loadFile(path.join(__dirname, '../renderer/squad-hud.html'));
    squadHudWindow.on('closed', () => { squadHudWindow = null; });
}

ipcMain.on('squad:open-hud', () => createSquadHudWindow());

// ═══ NET & PROXIMITY HUD LOGIC ═══
function createNetProximityHudWindow() {
    if (netProximityHudWindow && !netProximityHudWindow.isDestroyed()) {
        netProximityHudWindow.focus();
        return;
    }

    netProximityHudWindow = new BrowserWindow({
        width: 360,
        height: 520,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        alwaysOnTop: true,
        resizable: true,
        skipTaskbar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    netProximityHudWindow.setIgnoreMouseEvents(true, { forward: true });
    netProximityHudWindow.loadFile(path.join(__dirname, '../renderer/net-proximity-hud.html'));
    netProximityHudWindow.on('closed', () => { netProximityHudWindow = null; });
}

ipcMain.on('net-proximity:open-hud', () => createNetProximityHudWindow());

// ═══ OCR DEBUG LOGIC (v2.10.2) ═══
function createOcrDebugWindow() {
    if (ocrDebugWindow && !ocrDebugWindow.isDestroyed()) {
        ocrDebugWindow.focus();
        return;
    }

    ocrDebugWindow = new BrowserWindow({
        width: 250,
        height: 150,
        frame: false,
        alwaysOnTop: true,
        transparent: true,
        backgroundColor: '#00000000',
        resizable: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    ocrDebugWindow.loadFile(path.join(__dirname, '../renderer/ocr-debug.html'));
    ocrDebugWindow.on('closed', () => { ocrDebugWindow = null; });
}

ipcMain.on('ocr:open-debug', () => createOcrDebugWindow());

ipcMain.on('ocr:debug-update', (event, dataUrl) => {
    if (ocrDebugWindow && !ocrDebugWindow.isDestroyed()) {
        ocrDebugWindow.webContents.send('ocr:debug-update', dataUrl);
    }
});

ipcMain.on('ocr:debug-metadata', (event, data) => {
    if (ocrDebugWindow && !ocrDebugWindow.isDestroyed()) {
        ocrDebugWindow.webContents.send('ocr:debug-metadata', data);
    }
});

// ═══════════════════════════════════════════════════════════
// BLUEPRINT TRACKER
// ═══════════════════════════════════════════════════════════

const BLUEPRINT_DATA_FILE = path.join(app.getPath('userData'), 'blueprints.json');
const BLUEPRINT_RE = /Added notification "Received Blueprint:\s*([^:"]+):\s*"/i;
const TIMESTAMP_RE_BP = /^<(\d{4}-\d{2}-\d{2}T[\d:.\-+Z]+)>/;

// Scan active log and all historical log backups to populate correct blueprint dates
async function scanLogForBlueprints(logPath) {
    if (!logPath || !fs.existsSync(logPath)) return;
    try {
        console.log(`[Blueprint] Scanning log and backups for blueprint dates: ${logPath}`);
        
        // Find files to scan
        const filesToScan = [logPath];
        const logDir = path.dirname(logPath);
        const backupsDir = path.join(logDir, 'logbackups');
        if (fs.existsSync(backupsDir)) {
            const isDir = await fs.promises.stat(backupsDir).then(s => s.isDirectory()).catch(() => false);
            if (isDir) {
                const files = await fs.promises.readdir(backupsDir).catch(() => []);
                for (const file of files) {
                    const fullPath = path.join(backupsDir, file);
                    const isFile = await fs.promises.stat(fullPath).then(s => s.isFile()).catch(() => false);
                    if (isFile && (file.endsWith('.log') || file.endsWith('.txt'))) {
                        filesToScan.push(fullPath);
                    }
                }
            }
        }

        const data = loadBlueprintData();
        const collected = new Set(data.collected);
        if (!data.collectedAt) data.collectedAt = {};
        let updatedCount = 0;

        for (const filePath of filesToScan) {
            try {
                await new Promise(resolve => setImmediate(resolve));
                const content = await fs.promises.readFile(filePath, 'utf8');
                const lines = content.split('\n');
                for (let i = 0; i < lines.length; i++) {
                    if (i > 0 && i % 1000 === 0) {
                        await new Promise(resolve => setImmediate(resolve));
                    }
                    const line = lines[i];
                    const m = line.match(BLUEPRINT_RE);
                    if (!m) continue;
                    const name = m[1].trim();
                    const ts = line.match(TIMESTAMP_RE_BP);
                    if (ts) {
                        const timestamp = ts[1];
                        const currentTs = data.collectedAt[name];
                        const isNew = !collected.has(name);
                        if (isNew || !currentTs || new Date(timestamp) < new Date(currentTs)) {
                            if (isNew) {
                                collected.add(name);
                            }
                            data.collectedAt[name] = timestamp;
                            updatedCount++;
                        }
                    }
                }
            } catch (err) {
                console.error(`[Blueprint] Error scanning file ${filePath}:`, err.message);
            }
        }
        
        // Ensure all collected have a timestamp entry
        for (const item of collected) {
            if (!data.collectedAt[item]) {
                data.collectedAt[item] = new Date().toISOString();
            }
        }

        data.collected = Array.from(collected).sort();
        saveBlueprintData(data);
        console.log(`[Blueprint] Log directory scan complete: updated/added ${updatedCount} blueprint timestamps`);
    } catch (e) {
        console.error('[Blueprint] Failed to scan log directory:', e.message);
    }
}

// Wrap LogWatcher.start to scan the log for blueprints on watch start
const originalLogWatcherStart = LogWatcher.start.bind(LogWatcher);
LogWatcher.start = function(filePath) {
    scanLogForBlueprints(filePath);
    return originalLogWatcherStart(filePath);
};

function loadBlueprintData() {
    // Priority 1: full list fetched from sc-craft.tools (run: npm run update-blueprints)
    const fullListFile = path.join(__dirname, '..', '..', 'data', 'blueprint-masterlist-full.json');
    // Priority 2: hand-curated seed bundled with the app
    const seedFile     = path.join(__dirname, '..', '..', 'data', 'blueprints.json');

    let masterList = [];
    try {
        let fullList = [];
        let seedList = [];
        
        if (fs.existsSync(fullListFile)) {
            const full = JSON.parse(fs.readFileSync(fullListFile, 'utf8'));
            fullList = full.masterList || [];
        }
        if (fs.existsSync(seedFile)) {
            const seed = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
            seedList = seed.masterList || [];
        }
        
        // Merge the lists to ensure hand-curated items and Wikelo sources are included
        const map = new Map();
        
        // Add full list first
        fullList.forEach(item => {
            map.set(item.name.toLowerCase(), { ...item });
        });
        
        // Merge seed items (preferring curated sources and fields)
        seedList.forEach(item => {
            const lower = item.name.toLowerCase();
            if (map.has(lower)) {
                const existing = map.get(lower);
                map.set(lower, {
                    ...existing,
                    source: item.source || existing.source,
                    unreleased: item.unreleased !== undefined ? item.unreleased : existing.unreleased,
                    ingredients: (item.ingredients && item.ingredients.length > 0) ? item.ingredients : existing.ingredients
                });
            } else {
                map.set(lower, { ...item });
            }
        });
        
        masterList = Array.from(map.values());
        masterList.sort((a, b) => a.name.localeCompare(b.name));
        console.log(`[Blueprint] Loaded ${masterList.length} masterList entries (merged seed & full list)`);
    } catch (e) {
        console.warn('[Blueprint] Failed to load masterList:', e.message);
    }

    try {
        if (fs.existsSync(BLUEPRINT_DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(BLUEPRINT_DATA_FILE, 'utf8'));
            // Always use the best available masterList (never persist it to userData)
            data.masterList = masterList;
            return data;
        }
    } catch (e) { /* ignore */ }

    return { collected: [], masterList };
}

function saveBlueprintData(data) {
    try {
        fs.writeFileSync(BLUEPRINT_DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error('[Blueprint] Failed to save:', e.message);
    }
}

// Forward live BLUEPRINT_RECEIVED events to the renderer
LogWatcher.on('gamestate', (data) => {
    if (data.type === 'BLUEPRINT_RECEIVED' && dashboardWindow && !dashboardWindow.isDestroyed()) {
        dashboardWindow.webContents.send('blueprint:received', data);
    }
});

// Load current blueprint data
ipcMain.handle('blueprint:get-data', async () => {
    return loadBlueprintData();
});

// Run Tracker: expose just the master list (no blueprint collection state needed)
ipcMain.handle('blueprints:get-master-list', async () => {
    const data = loadBlueprintData();
    return data.masterList || [];
});


// Open file picker for old logs, scan them, merge into blueprints.json
ipcMain.handle('blueprint:scan-logs', async () => {
    const result = await dialog.showOpenDialog(dashboardWindow, {
        title: 'Select Game.log file(s) to scan for blueprints',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Log Files', extensions: ['log', 'txt'] }]
    });

    if (result.canceled || result.filePaths.length === 0) return null;

    const data = loadBlueprintData();
    const collected = new Set(data.collected);
    if (!data.collectedAt) data.collectedAt = {};
    const newlyFound = [];

    for (const filePath of result.filePaths) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split('\n');
            for (const line of lines) {
                const m = line.match(BLUEPRINT_RE);
                if (!m) continue;
                const name = m[1].trim();
                const ts = line.match(TIMESTAMP_RE_BP);
                const timestamp = ts ? ts[1] : new Date().toISOString();
                
                const currentTs = data.collectedAt[name];
                const isNew = !collected.has(name);
                if (isNew || !currentTs || new Date(timestamp) < new Date(currentTs)) {
                    if (isNew) {
                        collected.add(name);
                        newlyFound.push({ name, timestamp, file: path.basename(filePath) });
                    }
                    data.collectedAt[name] = timestamp;
                }
            }
        } catch (e) {
            console.error('[Blueprint] Failed to read log:', filePath, e.message);
        }
    }

    data.collected = Array.from(collected).sort();
    
    // Ensure all collected have a timestamp entry
    for (const item of data.collected) {
        if (!data.collectedAt[item]) {
            data.collectedAt[item] = new Date().toISOString();
        }
    }

    saveBlueprintData(data);

    return { data, newlyFound, scannedFiles: result.filePaths.length };
});

// Save updated master list
ipcMain.handle('blueprint:update-master', async (event, masterList) => {
    const data = loadBlueprintData();
    data.masterList = masterList;
    saveBlueprintData(data);
    return data;
});

// ══════════════════════════════════════════════════════════════════════════════
// SQUAD P2P SYSTEM (no external server required)
// ══════════════════════════════════════════════════════════════════════════════

const { SquadHost } = require('./squad-host');
const { SquadPeer } = require('./squad-peer');

let squadHost = null;
let squadPeer = null;
let mySquadInfo = { handle: 'Player', health: 100, ship: '', location: '' };

function pushSquadUpdate(squad) {
    if (dashboardWindow && !dashboardWindow.isDestroyed())
        dashboardWindow.webContents.send('squad:update', squad);
}

// Host a new session
ipcMain.handle('squad:host', async () => {
    if (squadPeer) { squadPeer.disconnect(); squadPeer = null; }
    if (squadHost) { squadHost.stop(); squadHost = null; }

    squadHost = new SquadHost();
    squadHost.on('squad:update', pushSquadUpdate);

    // Pre-populate host's own info from config
    mySquadInfo.handle = config.handle || config.rsiHandle || 'Host';
    try {
        const result = await squadHost.start(mySquadInfo, config.squadPort || 30000);
        return { success: true, ...result };
    } catch (e) {
        squadHost = null;
        return { success: false, error: e.message };
    }
});

// Join an existing session via friend code
ipcMain.handle('squad:join', async (event, code) => {
    if (squadHost) { squadHost.stop(); squadHost = null; }
    if (squadPeer) { squadPeer.disconnect(); squadPeer = null; }

    squadPeer = new SquadPeer();
    mySquadInfo.handle = config.handle || config.rsiHandle || 'Player';

    return new Promise(resolve => {
        const timeout = setTimeout(() => {
            resolve({ success: false, error: 'Connection timed out. Check the code or ask the host to verify their port is open.' });
        }, 10000);

        squadPeer.once('connected', () => {
            clearTimeout(timeout);
            resolve({ success: true });
        });
        squadPeer.once('error', err => {
            clearTimeout(timeout);
            resolve({ success: false, error: err });
        });
        squadPeer.on('squad:update', pushSquadUpdate);

        try {
            squadPeer.connect(code, mySquadInfo);
        } catch (e) {
            clearTimeout(timeout);
            resolve({ success: false, error: e.message });
        }
    });
});

// Leave / disband
ipcMain.handle('squad:leave', async () => {
    if (squadHost) { squadHost.stop(); squadHost = null; }
    if (squadPeer) { squadPeer.disconnect(); squadPeer = null; }
    return { success: true };
});

// Push live game events into the squad
LogWatcher.on('gamestate', data => {
    let changed = false;
    if (data.type === 'HEALTH_UPDATE' && data.value !== undefined) {
        mySquadInfo.health   = data.value;
        changed = true;
    }
    if (data.type === 'LOCATION' && data.value) {
        mySquadInfo.location = data.value;
        changed = true;
    }
    if ((data.type === 'SHIP_ENTER' || data.type === 'SHIP_CURRENT') && data.value) {
        mySquadInfo.ship     = data.value;
        changed = true;
    }
    if (data.type === 'SHIP_EXIT') {
        mySquadInfo.ship     = '';
        changed = true;
    }

    if (!changed) return;
    if (squadHost) squadHost.updateHostStatus(mySquadInfo);
    if (squadPeer) squadPeer.sendUpdate(mySquadInfo);
});

// ── Patch/generate personalised StarStrings global.ini mod file ──────────────
ipcMain.handle('blueprint:generate-mod', async () => {
    const { generateMod } = require('./blueprint-mod-generator');

    // Ask user to pick their Star Citizen LIVE folder
    const result = await dialog.showOpenDialog({
        title: 'Select your Star Citizen LIVE folder',
        properties: ['openDirectory'],
        buttonLabel: 'Select LIVE Folder',
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };

    const liveFolder = result.filePaths[0];
    const cacheFile  = path.join(app.getPath('userData'), 'starstrings-contracts-cache.ini');

    const data      = loadBlueprintData();
    const collected = data.collected || [];

    try {
        const info = await generateMod(collected, liveFolder, cacheFile);
        return {
            success:      true,
            outFile:      info.outFile,
            source:       info.source,
            markedCount:  info.markedCount,
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
});
