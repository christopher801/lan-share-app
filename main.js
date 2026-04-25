/**
 * main.js — Electron main process
 * Flou Zender-style: wè aparèy → chwazi fichye → voye → aksepte → fini
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path  = require('path');
const os    = require('os');
const fs    = require('fs');
const Discovery         = require('./network/discovery');
const ConnectionManager = require('./network/connection');
const { generateSessionId } = require('./network/encryption');

const DOWNLOAD_DIR = path.join(os.homedir(), 'LAN Share Downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

const DEVICE_ID   = generateSessionId();
const DEVICE_NAME = `${os.userInfo().username} (${os.hostname()})`;

let mainWindow  = null;
let discovery   = null;
let connManager = null;

// peerId → { acceptFn, rejectFn }
const pendingRequests = new Map();

// ─── Window ──────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width:           940,
    height:          680,
    minWidth:        780,
    minHeight:       520,
    backgroundColor: '#0f172a',
    frame:           true,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── Lifecycle ───────────────────────────────────────────────────

app.whenReady().then(async () => {
  createWindow();
  await startNetworking();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => { cleanup(); if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', cleanup);

function cleanup() {
  if (discovery)   discovery.stop();
  if (connManager) connManager.stopServer();
}

// ─── Networking ──────────────────────────────────────────────────

async function startNetworking() {
  connManager = new ConnectionManager({
    id:          DEVICE_ID,
    name:        DEVICE_NAME,
    downloadDir: DOWNLOAD_DIR,

    // Resevwa wè modal: "X vle voye 3 fichye (48 MB)"
    onIncomingRequest: (peerId, peerName, peerAddress, fileCount, totalSize, files, acceptFn, rejectFn) => {
      pendingRequests.set(peerId, { acceptFn, rejectFn });
      send('incoming-request', { peerId, peerName, peerAddress, fileCount, totalSize, files });
    },
  });

  connManager.on('transfer-start',     (peerId, peerName) => send('transfer-start',    { peerId, peerName }));
  connManager.on('progress',           (peerId, idx, filename, received, total) => send('progress', { peerId, fileIdx: idx, filename, received, total }));
  connManager.on('transfer-complete',  (peerId) => send('transfer-complete',  { peerId, downloadDir: DOWNLOAD_DIR }));
  connManager.on('transfer-cancelled', (peerId) => send('transfer-cancelled', { peerId }));

  const tcpPort = await connManager.startServer();

  discovery = new Discovery(DEVICE_NAME, tcpPort);
  discovery.on('device-found',   (d)  => send('device-found',   d));
  discovery.on('device-updated', (d)  => send('device-updated', d));
  discovery.on('device-lost',    (id) => send('device-lost',    id));
  discovery.start();

  console.log(`[Main] LAN Share — "${DEVICE_NAME}" id=${DEVICE_ID} tcp=:${tcpPort}`);
}

// ─── IPC ─────────────────────────────────────────────────────────

ipcMain.handle('get-device-info', () => ({
  id: DEVICE_ID, name: DEVICE_NAME, downloadDir: DOWNLOAD_DIR,
}));

ipcMain.handle('pick-files', async () => {
  if (!mainWindow) return [];
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    title: 'Chwazi fichye pou voye',
  });
  return r.canceled ? [] : r.filePaths;
});

// Sender rele sa — pa gen PIN, jis voye
ipcMain.handle('send-files', async (_e, peerId, filePaths) => {
  const peer = discovery.getDevices().find(d => d.id === peerId);
  if (!peer) throw new Error('Aparèy pa jwenn');
  if (!filePaths || !filePaths.length) throw new Error('Pa gen fichye chwazi');

  try {
    await connManager.sendToPeer(peer, filePaths, (idx, filename, sent, total) => {
      send('progress', { peerId, fileIdx: idx, filename, received: sent, total });
    });
    send('transfer-complete', { peerId, downloadDir: null });
  } catch (err) {
    console.error('[Main] sendToPeer error:', err.message);
    send('transfer-error', { peerId, message: err.message });
    throw err;
  }
});

ipcMain.handle('cancel-transfer',    (_e, peerId) => connManager.cancelTransfer(peerId));
ipcMain.handle('open-download-dir',  ()           => shell.openPath(DOWNLOAD_DIR));

ipcMain.handle('accept-connection', (_e, peerId) => {
  const req = pendingRequests.get(peerId);
  if (req) { req.acceptFn(); pendingRequests.delete(peerId); }
});

ipcMain.handle('reject-connection', (_e, peerId) => {
  const req = pendingRequests.get(peerId);
  if (req) { req.rejectFn(); pendingRequests.delete(peerId); }
});

function send(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}
