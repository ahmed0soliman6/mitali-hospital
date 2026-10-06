const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

let mainWindow;
let updaterConfigured = false;
let updateState = { status: 'idle', version: null, percent: 0, error: null };

function isExternalUrl(url) {
  return /^https?:\/\//i.test(String(url || ''));
}

function publishUpdateState(next) {
  updateState = Object.assign({ status: 'idle', version: null, percent: 0, error: null }, next || {});
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-state', updateState);
}

async function checkForUpdates() {
  if (!app.isPackaged || !updaterConfigured) return updateState;
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    log.warn('Auto-update check failed:', error);
    publishUpdateState({ status: 'error', error: String(error && error.message || error) });
  }
  return updateState;
}

function setupAutoUpdater() {
  if (!app.isPackaged || updaterConfigured) return;
  updaterConfigured = true;
  autoUpdater.logger = log;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => publishUpdateState({ status: 'checking', error: null }));
  autoUpdater.on('update-available', info => publishUpdateState({ status: 'available', version: info.version, error: null }));
  autoUpdater.on('update-not-available', info => publishUpdateState({ status: 'latest', version: info && info.version || app.getVersion(), error: null }));
  autoUpdater.on('download-progress', progress => publishUpdateState({ status: 'downloading', percent: Number(progress.percent || 0), error: null }));
  autoUpdater.on('update-downloaded', info => publishUpdateState({ status: 'downloaded', version: info.version, percent: 100, error: null }));
  autoUpdater.on('error', error => {
    log.error('Auto-update failed:', error);
    publishUpdateState({ status: 'error', error: String(error && error.message || error) });
  });

  ipcMain.handle('update:get-state', () => updateState);
  ipcMain.handle('update:check', () => checkForUpdates());
  ipcMain.handle('update:download', async () => {
    if (!app.isPackaged) return updateState;
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      log.error('Auto-update download failed:', error);
      publishUpdateState({ status: 'error', error: String(error && error.message || error) });
    }
    return updateState;
  });
  ipcMain.handle('update:install', () => {
    if (updateState.status !== 'downloaded') return false;
    autoUpdater.quitAndInstall(false, true);
    return true;
  });

  // لا يُغلق التطبيق تلقائيًا. الفحص الأول بعد فتح النافذة، ثم كل ست ساعات.
  setTimeout(() => checkForUpdates(), 30_000);
  setInterval(() => checkForUpdates(), 6 * 60 * 60 * 1000);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: '#102A35',
    autoHideMenuBar: true,
    title: 'مستشفى ميت على التخصصي',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isExternalUrl(url) && !url.startsWith('https://mitali1.vercel.app/')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    createWindow();
    setupAutoUpdater();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
