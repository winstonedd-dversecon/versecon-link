const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const LogWatcher = require('./log-watcher');
const fs = require('fs');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 400,
        height: 600,
        frame: false, // Overlay style
        transparent: true,
        alwaysOnTop: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

    // Log Watcher Integration
    LogWatcher.on('gamestate', (data) => {
        if (mainWindow) {
            mainWindow.webContents.send('log:update', data);
        }
    });

    LogWatcher.on('status', (status) => {
        if (mainWindow) mainWindow.webContents.send('log:status', status);
    });

    // API Integration
    const APIClient = require('./api-client');

    // Forward API events to Renderer
    APIClient.on('party', (data) => {
        if (mainWindow) mainWindow.webContents.send('api:party', data);
    });

    // Start watching automatically
    LogWatcher.start();
}

ipcMain.on('app:login', (event, token) => {
    const APIClient = require('./api-client');
    APIClient.token = token;
    APIClient.connectSocket(token);
});

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
