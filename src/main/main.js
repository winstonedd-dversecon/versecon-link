const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const LogWatcher = require('./log-watcher');
const APIClient = require('./api-client');

let dashboardWindow;
let overlayWindow;

function createWindows() {
    // 1. Main Dashboard Window
    dashboardWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        frame: false, // Custom frame in HTML? Or standard? Let's go standard for now for drag support effortlessly
        title: 'VerseCon Link',
        backgroundColor: '#0b0c10',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    dashboardWindow.loadFile(path.join(__dirname, '../renderer/dashboard.html'));

    // 2. Overlay Window (Transparent)
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;

    overlayWindow = new BrowserWindow({
        width: 300,
        height: 500,
        x: width - 320,
        y: 50, // Top Right
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: class { return false
    }, // effectively false
        skipTaskbar: true,
        webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
    }
    });

overlayWindow.loadFile(path.join(__dirname, '../renderer/overlay.html'));

    // Optional: Ignore mouse events? 
    // If user wants click-through: overlayWindow.setIgnoreMouseEvents(true);
    // For now, let's keep interactions enabled for moving/resizing if implemented.
}

// IPC Handlers
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
});


// Logic: Broadcast to ALL windows
function broadcast(channel, data) {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) dashboardWindow.webContents.send(channel, data);
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.webContents.send(channel, data);
}

// Log Watcher Events
LogWatcher.on('gamestate', (data) => broadcast('log:update', data));
LogWatcher.on('status', (status) => broadcast('log:status', status));

// API Events
APIClient.on('party', (data) => broadcast('api:party', data));
APIClient.on('status', (status) => broadcast('api:status', status)); // Needs to be added to APIClient

app.whenReady().then(() => {
    createWindows();
    LogWatcher.start();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
