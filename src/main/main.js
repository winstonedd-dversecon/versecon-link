const { app, BrowserWindow, ipcMain, screen, dialog, Tray, Menu, nativeImage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const express = require('express');
const http = require('http');
const LogWatcher = require('./log-watcher');
const APIClient = require('./api-client');
const UpdateManager = require('./update-manager'); // Phase 6
const TelemetryEngine = require('./telemetry/telemetry-engine'); // Phase 6 Telemetry

let dashboardWindow;
let overlayWindow;
let alertWindow;
let remoteApp = null;
let remoteServer = null;
let tray = null;
let parkingUpdateManager = null;
let telemetryEngine = null; // Telemetry Instance
let isQuitting = false;
let dndMode = false;

// ═══ FEATURE FLAGS ═══
const IS_ADMIN = process.env.VCON_ROLE === 'admin' || process.env.VCON_DEV === 'true';
console.log('[Main] Role:', IS_ADMIN ? 'ADMIN/DEV' : 'USER');


let config = { shipMap: {}, customPatterns: [], customLocations: {} };
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
            if (!config.logPath) config.logPath = null; // Initialize logPath (will be auto-detected if null)
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
    // 1. Main Dashboard Window
    dashboardWindow = new BrowserWindow({
        width: 1100,
        height: 750,
        frame: false,
        title: 'VerseCon Link',
        backgroundColor: '#0b0c10',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    dashboardWindow.loadFile(path.join(__dirname, '../renderer/dashboard.html'));

    dashboardWindow.webContents.on('did-finish-load', () => {
        LogWatcher.emitCurrentState();
        LogWatcher.emitUnknowns();
        dashboardWindow.webContents.send('log:status', { connected: LogWatcher.isWatching, path: LogWatcher.filePath });
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
            });

            telemetryEngine.on('telemetry', (data) => {
                console.log('[Main] Telemetry Event:', data.type);
                broadcast('telemetry:event', data);
                if (dashboardWindow && !dashboardWindow.isDestroyed()) {
                    dashboardWindow.webContents.send('telemetry:update', data);
                }
            });
            telemetryEngine.start();

            // Initialize Friend Sync logic

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
        alwaysOnTop: true,
        resizable: false,
        skipTaskbar: true,
        focusable: false, // Don't steal focus from game
        type: 'toolbar_menu', // Better for overlays
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
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
    });

    // 3. Alert Window (Full-screen transparent for HUD warnings)
    alertWindow = new BrowserWindow({
        width: primaryDisplay.size.width,
        height: primaryDisplay.size.height,
        x: 0,
        y: 0,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        skipTaskbar: true,
        focusable: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    alertWindow.loadFile(path.join(__dirname, '../renderer/alert.html'));
    alertWindow.setIgnoreMouseEvents(true);
    alertWindow.setAlwaysOnTop(true, 'screen-saver'); // Fix: Ensure it shows over game
    alertWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    alertWindow.hide(); // Hidden by default, shown on alerts
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

// Alert window control
ipcMain.on('alert:show', (event, data) => {
    if (alertWindow && !alertWindow.isDestroyed()) {
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
    if (alertWindow && !alertWindow.isDestroyed()) {
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
    if (newConfig.overlayPositions !== undefined) config.overlayPositions = newConfig.overlayPositions;

    // Philips Hue Settings
    if (newConfig.hueEnabled !== undefined) config.hueEnabled = newConfig.hueEnabled;
    if (newConfig.hueBridge !== undefined) config.hueBridge = newConfig.hueBridge;
    if (newConfig.hueUser !== undefined) config.hueUser = newConfig.hueUser;
    if (newConfig.hueLights !== undefined) config.hueLights = newConfig.hueLights;

    saveConfig();

    // Broadcast updates if needed
    broadcast('settings:updated', config);
});

// ═══════════════════════════════════════════════════════
// BROADCAST (ALL WINDOWS)
// ═══════════════════════════════════════════════════════

function broadcast(channel, data) {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) dashboardWindow.webContents.send(channel, data);
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.webContents.send(channel, data);
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

LogWatcher.on('gamestate', (data) => {
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

    broadcast('log:update', data);

    // ═══ PATTERN REACTIONS (v2.8) ═══
    handlePatternReactions(data);

    // ═══ HUE REACTIONS (v2.9) ═══
    handleHueSituation(data);

    // ═════ FRIEND SHARING (Phase 5) ═══
    if (data.type === 'LOCATION' && config.shareLocation) {
        APIClient.updateLocation(data);
    }

    // Critical alerts → show alert window + tray notification
    if (['STATUS', 'ZONE', 'HAZARD_FIRE', 'DEATH', 'VEHICLE_DESTRUCTION'].includes(data.type)) {
        if (alertWindow && !alertWindow.isDestroyed()) {
            alertWindow.show();
            alertWindow.webContents.send('alert:trigger', data);
        }

        if (data.type === 'STATUS') {
            if (data.value === 'death') {
                showTrayNotification('☠️ DEATH DETECTED', 'Your character has died.');
            } else if (data.value === 'suffocating') {
                showTrayNotification('🌡️ SUFFOCATING', 'Check your helmet seal!');
            }
        } else if (data.type === 'DEATH') {
            const killer = data.details?.killer || 'Unknown';
            showTrayNotification('☠️ KILLED', `Killed by ${killer}`);
        } else if (data.type === 'HAZARD_FIRE') {
            showTrayNotification('🔥 FIRE', data.value || 'Fire detected on ship');
        }
    }

    // ═══ HUD ALERTS (Phase 3) ═══
    if (data.type === 'INTERDICTION') {
        if (alertWindow && !alertWindow.isDestroyed()) {
            alertWindow.show();
            alertWindow.webContents.send('alert:trigger', { type: 'STATUS', value: 'interdiction' });
        }
    }
    if (data.type === 'VEHICLE_DEATH') {
        if (alertWindow && !alertWindow.isDestroyed()) {
            alertWindow.show();
            alertWindow.webContents.send('alert:trigger', { type: 'STATUS', value: 'soft_death' });
        }
    }

    // Ship events - tray notification
    if (data.type === 'SHIP_ENTER') {
        showTrayNotification('🚀 Ship Entered', `Boarded: ${data.value}`);
        if (dashboardWindow && !dashboardWindow.isDestroyed()) {
            dashboardWindow.webContents.send('settings:last-ship', data.value);
        }
    } else if (data.type === 'SHIP_EXIT') {
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
            config.activeMissions[id] = {
                id: id,
                title: data.value,
                objective: 'Pending objective...',
                status: 'active',
                tracked: true, // Auto-track new ones
                timestamp: now
            };
            // Untrack others? Maybe user wants to track the new one.
            Object.values(config.activeMissions).forEach(m => { if (m.id !== id) m.tracked = false; });
            showTrayNotification('📋 Contract Accepted', data.value);
        }
        else if (data.type === 'MISSION_OBJECTIVE') {
            if (config.activeMissions[id]) {
                config.activeMissions[id].objective = data.value;
                config.activeMissions[id].timestamp = now;
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
            if (config.activeMissions[id]) {
                config.activeMissions[id].status = data.value; // 'completed', 'failed'
                // Remove from active list after short delay? 
                // User wants to see history?
                // For now, keep it in list but mark status, maybe renderer filters it or shows it dimmed.
                // Or just delete it if success?
                // User said "currect contracts in a neat way". Completed are not current.
                if (data.value === 'completed' || data.value === 'ended') {
                    delete config.activeMissions[id];
                    showTrayNotification('✅ Contract Complete', config.activeMissions[id]?.title || 'Mission');
                } else if (data.value === 'failed') {
                    config.activeMissions[id].status = 'failed';
                    showTrayNotification('❌ Contract Failed', config.activeMissions[id]?.title || 'Mission');
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
                    if (regex instanceof RegExp) {
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
    NavigationParser.setCustomLocations(locations);
    broadcast('settings:custom-locations-updated', locations);
    return true;
});

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
    try {
        await Promise.all(config.hueLights.map(id =>
            fetch(`http://${config.hueBridge}/api/${config.hueUser}/lights/${id}/state`, {
                method: 'PUT',
                body: JSON.stringify(state)
            })
        ));
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
    const unifiedPatterns = [
        ...(config.customPatterns || []),
        ...(db.patterns || [])
    ];
    LogWatcher.setCustomPatterns(unifiedPatterns);
    console.log('[Main] Unified patterns updated:', unifiedPatterns.length);
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
        if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.webContents.send('overlay:unlock', unlock);
        }
    });

    app.whenReady().then(() => {
        loadConfig(); // Load saved config
        patternDatabase = loadPatternDB(); // Load pattern DB

        // Initialize NavigationParser with custom locations AFTER config is loaded
        if (config.customLocations) {
            NavigationParser.setCustomLocations(config.customLocations);
        }

        LogWatcher.setShipMap(config.shipMap); // Apply saved map

        // Only send user-defined custom patterns to the CustomParser
        // Built-in patterns from getBuiltinPatterns() are for Log Database display only
        const userPatterns = (config.customPatterns || []).filter(p => p.source !== 'builtin');
        LogWatcher.setCustomPatterns(userPatterns);

        createWindows();
        createTray();

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
