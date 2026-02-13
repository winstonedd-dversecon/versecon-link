const { app, BrowserWindow, ipcMain, screen, dialog, Tray, Menu, nativeImage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const LogWatcher = require('./log-watcher');
const APIClient = require('./api-client');
const UpdateManager = require('./update-manager'); // Phase 6
const TelemetryEngine = require('./telemetry/telemetry-engine'); // Phase 6 Telemetry

let dashboardWindow;
let overlayWindow;
let alertWindow;
let tray = null;
let parkingUpdateManager = null;
let telemetryEngine = null; // Telemetry Instance
let isQuitting = false;
let dndMode = false;

// ═══ FEATURE FLAGS ═══
const IS_ADMIN = process.env.VCON_ROLE === 'admin' || process.env.VCON_DEV === 'true';
console.log('[Main] Role:', IS_ADMIN ? 'ADMIN/DEV' : 'USER');


let config = { shipMap: {}, customPatterns: [] };
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
        // Restore persistent spawn point if not yet in cache
        if (config.spawnPoint && !LogWatcher.cachedState.spawn) {
            LogWatcher.cachedState.spawn = config.spawnPoint;
            dashboardWindow.webContents.send('log:update', { type: 'SPAWN_POINT', value: config.spawnPoint });
        }

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

            // Legacy Compatibility: Feed raw lines to LogWatcher
            telemetryEngine.on('raw', (line) => {
                LogWatcher.processLine(line, false);
            });

            // Start if path exists
            if (config.logPath) {
                console.log('[Main] Starting Telemetry Engine on:', config.logPath);
                telemetryEngine.setLogPath(config.logPath);
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

// ═══════════════════════════════════════════════════════
// SYSTEM TRAY
// ═══════════════════════════════════════════════════════

function createTray() {
    // Create a simple 16x16 tray icon using nativeImage
    const iconSize = 16;
    const icon = nativeImage.createEmpty();

    // Use a data URL for a simple orange circle icon
    const canvas = `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA0ElEQVQ4T2NkoBAwUqifYdAY8J+B4T8jI+N/BkZGJgZGxv8MDIz/GUBsJkYQm5GRiQHEBvGRxYDqGJHVwA1ghBvACHYBCzPLfwYmRqgBjP+ZGJkYQfxBYAAjyOv/wYGA2AgywDAwMIAMgHkB5AwUZ4DCgBEmBjUA5C1kcYpigJmJCRQFEDYoOFBDABYDDIwMYDaID/MCTB5kCCPYAAZkNSCbwM5AhoEFCCiGoGrAAUEhGECuZkQXYwIbAvIGVhv+w4MAuxgj2A0ENAFhLgAA4aVjEV2F5y4AAAAASUVORK5CYII=`;

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
        icon: nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA0ElEQVQ4T2NkoBAwUqifYdAY8J+B4T8jI+N/BkZGJgZGxv8MDIz/GUBsJkYQm5GRiQHEBvGRxYDqGJHVwA1ghBvACHYBCzPLfwYmRqgBjP+ZGJkYQfxBYAAjyOv/wYGA2AgywDAwMIAMgHkB5AwUZ4DCgBEmBjUA5C1kcYpigJmJCRQFEDYoOFBDABYDDIwMYDaID/MCTB5kCCPYAAZkNSCbwM5AhoEFCCiGoGrAAUEhGECuZkQXYwIbAvIGVhv+w4MAuxgj2A0ENAFhLgAA4aVjEV2F5y4AAAAASUVORK5CYII='),
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
        const selectedPath = result.filePaths[0];

        // Update Config
        config.logPath = selectedPath;
        saveConfig();

        // Update Telemetry Engine
        if (telemetryEngine) {
            telemetryEngine.setLogPath(selectedPath);
        } else {
            // Fallback to legacy if engine failed init
            LogWatcher.setPath(selectedPath); // Legacy
        }

        return selectedPath;
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

ipcMain.on('command:ack', (event, data) => {
    if (APIClient.socket && APIClient.socket.connected) {
        APIClient.socket.emit('command:ack', data);
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
// Initialize with config
if (config.customLocations) {
    NavigationParser.setCustomLocations(config.customLocations);
}

ipcMain.on('settings:save-custom-locations', (event, locations) => {
    config.customLocations = locations;
    saveConfig();
    NavigationParser.setCustomLocations(locations);
    broadcast('settings:custom-locations-updated', locations);
});

// Generic Settings Save
ipcMain.on('settings:save', (event, newConfig) => {
    // Merge known keys
    if (newConfig.logPath !== undefined) config.logPath = newConfig.logPath;
    if (newConfig.volume !== undefined) config.volume = newConfig.volume;
    if (newConfig.soundEnabled !== undefined) config.soundEnabled = newConfig.soundEnabled;
    if (newConfig.overlayEnabled !== undefined) config.overlayEnabled = newConfig.overlayEnabled;
    if (newConfig.autoCleanMissions !== undefined) config.autoCleanMissions = newConfig.autoCleanMissions;
    if (newConfig.shareLocation !== undefined) config.shareLocation = newConfig.shareLocation; // Phase 5

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
let lastRawEmit = 0;
LogWatcher.on('raw-line', (line) => {
    const now = Date.now();
    if (dashboardWindow && !dashboardWindow.isDestroyed() && (now - lastRawEmit > 100)) {
        dashboardWindow.webContents.send('log:raw', line);
        lastRawEmit = now;
    }
});

LogWatcher.on('gamestate', (data) => {
    broadcast('log:update', data);

    // ═════ FRIEND SHARING (Phase 5) ═══
    if (data.type === 'LOCATION' && config.shareLocation) {
        APIClient.updateLocation(data);
    }

    // Critical alerts → show alert window + tray notification
    if (data.type === 'STATUS' || data.type === 'ZONE' || data.type === 'HAZARD_FIRE') {
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
        // Send to dashboard for debug
        if (dashboardWindow && !dashboardWindow.isDestroyed()) {
            dashboardWindow.webContents.send('settings:last-ship', data.value);
        }
    } else if (data.type === 'SHIP_EXIT') {
        showTrayNotification('🚀 Ship Exited', `Left: ${data.value}`);
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
                // Let's keep it for history until cleared.
                // Actually, let's delete if 'completed' to prevent clutter?
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
    if (data.type === 'SESSION_START') cachedState.startTime = data.value;
    if (data.type === 'BUILD_INFO') cachedState.build = data.value;
    if (data.type === 'HANGAR_STATE') {
        cachedState.hangarState = data.value;
        cachedState.hangarStartTime = Date.now();
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
    LogWatcher.setCustomPatterns(patterns);
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
    // Assuming LogWatcher/LogEngine needs to know? 
    // Actually, dashboard handles the mapping for display, 
    // but if we want backend to know, we might need a setter.
    // For now, only Dashboard uses it for display mapping.
    return true;
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

    app.whenReady().then(() => {
        loadConfig(); // Load saved config
        LogWatcher.setShipMap(config.shipMap); // Apply saved map
        LogWatcher.setCustomPatterns(config.customPatterns); // Apply custom patterns
        createWindows();
        createTray();

        // Fix: Auto-load saved log path if available
        LogWatcher.start(config.logPath);


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
