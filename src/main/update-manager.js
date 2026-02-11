const { autoUpdater } = require('electron-updater');
const { ipcMain } = require('electron');

class UpdateManager {
    constructor(mainWindow) {
        this.mainWindow = mainWindow;
        this.updateAvailable = false;

        // Configure autoUpdater
        autoUpdater.logger = require('console');
        autoUpdater.autoDownload = false; // Let user decide

        this.initListeners();
    }

    initListeners() {
        // Electron-Updater Events
        autoUpdater.on('checking-for-update', () => {
            this.send('update:status', { status: 'checking' });
        });

        autoUpdater.on('update-available', (info) => {
            this.updateAvailable = true;
            this.send('update:available', info);
        });

        autoUpdater.on('update-not-available', (info) => {
            this.send('update:not-available', info);
        });

        autoUpdater.on('error', (err) => {
            this.send('update:error', { message: err.message });
        });

        autoUpdater.on('download-progress', (progressObj) => {
            this.send('update:progress', progressObj);
        });

        autoUpdater.on('update-downloaded', (info) => {
            this.send('update:downloaded', info);
        });

        // IPC Handlers
        ipcMain.on('update:check', () => {
            autoUpdater.checkForUpdates();
        });

        ipcMain.on('update:download', () => {
            autoUpdater.downloadUpdate();
        });

        ipcMain.on('update:install', () => {
            autoUpdater.quitAndInstall();
        });
    }

    send(channel, data) {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send(channel, data);
        }
    }
}

module.exports = UpdateManager;
