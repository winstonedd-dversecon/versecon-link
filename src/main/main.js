const { app, BrowserWindow, ipcMain, screen, dialog, Tray, Menu, nativeImage, Notification } = require('electron');
const path = require('path');
const fs = require('fs'); // Added for config persistence
const LogWatcher = require('./log-watcher');
const APIClient = require('./api-client');

let dashboardWindow;
let overlayWindow;
let alertWindow;
let tray = null;
let isQuitting = false;
let dndMode = false;

let config = { shipMap: {}, customPatterns: [] };
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

// Helper to access static patterns from instance
const DEFAULT_PATTERNS = LogWatcher.constructor.DEFAULT_PATTERNS; // Ensure this is not empty

// ═══════════════════════════════════════════════════════
// CONFIG HELPERS
// ═══════════════════════════════════════════════════════

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
            config = JSON.parse(data);
            if (!config.shipMap) config.shipMap = {};
            if (!config.customPatterns) config.customPatterns = [];
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
    });

    // Close-to-tray behavior
    dashboardWindow.on('close', (e) => {
        if (!isQuitting) {
            e.preventDefault();
            dashboardWindow.hide();
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
        if (dashboardWindow) {
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
                if (dashboardWindow) {
                    dashboardWindow.show();
                    dashboardWindow.focus();
                }
            }
        },
        {
            label: overlayWindow && overlayWindow.isVisible() ? 'Hide Overlay' : 'Show Overlay',
            click: () => {
                if (overlayWindow) {
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
    if (overlayWindow.isVisible()) {
        overlayWindow.hide();
    } else {
        overlayWindow.show();
    }
    updateTrayMenu();
});

ipcMain.handle('app:select-log', async () => {
    const result = await dialog.showOpenDialog(dashboardWindow, {
        properties: ['openFile'],
        filters: [{ name: 'Log Files', extensions: ['log', 'txt'] }]
    });

    if (!result.canceled && result.filePaths.length > 0) {
        const selectedPath = result.filePaths[0];
        LogWatcher.setPath(selectedPath);
        return selectedPath;
    }
    return null;
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

    // v2.2 - Broadcast to Overlay/Alert Windows if requested
    if (data.broadcast) {
        if (alertWindow && !alertWindow.isDestroyed()) {
            alertWindow.show();
            alertWindow.webContents.send('alert:trigger', { type: 'COMMAND', value: data });
        }
        if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.webContents.send('alert:trigger', { type: 'COMMAND', value: data });
        }
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

// Track connection states for tray
let logConnected = false;
let apiConnected = false;

// Log Watcher Events
LogWatcher.on('raw-line', (line) => {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
        // Send every line? this might be heavy. 
        // Let's send it and rely on renderer to cap the list size.
        dashboardWindow.webContents.send('log:raw', line);
    }
});

LogWatcher.on('gamestate', (data) => {
    broadcast('log:update', data);

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

    // Mission events
    if (data.type === 'MISSION') {
        const icons = { accepted: '📋', completed: '✅', failed: '❌' };
        showTrayNotification(`${icons[data.value] || '📋'} Mission ${data.value}`, data.detail || 'Mission update');
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
    } else if (data.type === 'GAME_LEAVE') {
        showTrayNotification('🎮 Game Left', 'Disconnected from server');
    }

    // Medical
    if (data.type === 'MEDICAL_BED') {
        showTrayNotification('🏥 Medical Bed', 'Entered medical bed');
    }
    if (data.type === 'SPAWN_SET') {
        showTrayNotification('📍 Spawn Point Set', data.value || 'New spawn location');
    }
    // v2.2 - Custom Alerts (User Defined)
    if (data.type === 'CUSTOM') {
        // Show Tray Notification for all custom matches
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

ipcMain.handle('settings:get-default-patterns', async () => {
    // Return regexes as strings for UI
    const defaults = {};
    // LogWatcher is an instance, so accessing static property requires constructor
    // Or we could export the class separately, but this is quicker given the structure.
    const patterns = LogWatcher.constructor.DEFAULT_PATTERNS || {};

    for (const [key, regex] of Object.entries(patterns)) {
        defaults[key] = regex.source;
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
        LogWatcher.start();

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
