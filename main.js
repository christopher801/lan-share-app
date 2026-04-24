/**
 * main.js
 * Electron main process — orchestrates discovery, connection, and file transfer.
 *
 * IPC channels handled here:
 *   Invoke (renderer → main):
 *     get-device-info, pick-files, send-files, cancel-transfer,
 *     accept-connection, reject-connection, submit-pin, open-download-dir
 *
 *   Push (main → renderer):
 *     device-found, device-updated, device-lost,
 *     incoming-request, show-pin,
 *     transfer-start, progress, transfer-complete, transfer-cancelled, transfer-error
 */

const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
}                     = require('electron');
const path            = require('path');
const os              = require('os');
const fs              = require('fs');
const Discovery       = require('./network/discovery');
const ConnectionManager = require('./network/connection');
const { generateSessionId } = require('./network/encryption');

// ─── Download directory ─────────────────────────────────────────────────────

const DOWNLOAD_DIR = path.join(os.homedir(), 'LAN Share Downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

// ─── Device identity ────────────────────────────────────────────────────────

const DEVICE_ID   = generateSessionId();
const DEVICE_NAME = `${os.userInfo().username} (${os.hostname()})`;

// ─── State ──────────────────────────────────────────────────────────────────

let mainWindow    = null;
let discovery     = null;
let connManager   = null;

// Pending connection requests waiting for UI accept/reject
// peerId → { acceptFn, rejectFn }
const pendingRequests = new Map();

// ─── Window ─────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width:           940,
    height:          680,
    minWidth:        780,
    minHeight:       520,
    backgroundColor: '#0f172a',
    titleBarStyle:   'hiddenInset',
    frame:           process.platform !== 'darwin',
    webPreferences: {
      preload:           path.join(__dirname, 'preload.js'),
      contextIsolation:  true,
      nodeIntegration:   false,
      sandbox:           false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Open DevTools only in dev mode
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── App lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  createWindow();
  await startNetworking();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  cleanup();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', cleanup);

function cleanup() {
  if (discovery)   discovery.stop();
  if (connManager) connManager.stopServer();
}

// ─── Networking setup ────────────────────────────────────────────────────────

async function startNetworking() {
  // 1. Start TCP server on a random port
  connManager = new ConnectionManager({
    id:          DEVICE_ID,
    name:        DEVICE_NAME,
    downloadDir: DOWNLOAD_DIR,

    onIncomingRequest: (peerId, peerName, peerAddress, acceptFn, rejectFn) => {
      pendingRequests.set(peerId, { acceptFn, rejectFn });
      send('incoming-request', { peerId, peerName, peerAddress });
    },

    onPinRequired: (peerId, peerName, pin) => {
      send('show-pin', { peerId, peerName, pin });
    },
  });

  connManager.on('transfer-start', (peerId, peerName) => {
    send('transfer-start', { peerId, peerName });
  });

  connManager.on('progress', (peerId, fileIdx, filename, received, total) => {
    send('progress', { peerId, fileIdx, filename, received, total });
  });

  connManager.on('transfer-complete', (peerId) => {
    send('transfer-complete', { peerId, downloadDir: DOWNLOAD_DIR });
  });

  connManager.on('transfer-cancelled', (peerId) => {
    send('transfer-cancelled', { peerId });
  });

  const tcpPort = await connManager.startServer();

  // 2. Start UDP discovery
  discovery = new Discovery(DEVICE_NAME, tcpPort);

  discovery.on('device-found',   (device) => send('device-found',   device));
  discovery.on('device-updated', (device) => send('device-updated', device));
  discovery.on('device-lost',    (id)     => send('device-lost',    id));

  discovery.start();
  console.log(`[Main] LAN Share running — id=${DEVICE_ID} name="${DEVICE_NAME}" tcpPort=${tcpPort}`);
}

// ─── IPC handlers ────────────────────────────────────────────────────────────

/** Return device info to renderer */
ipcMain.handle('get-device-info', () => ({
  id:   DEVICE_ID,
  name: DEVICE_NAME,
  downloadDir: DOWNLOAD_DIR,
}));

/** Open OS file picker */
ipcMain.handle('pick-files', async () => {
  if (!mainWindow) return [];
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    title: 'Select files to send',
  });
  return result.canceled ? [] : result.filePaths;
});

/** Send files to a peer */
ipcMain.handle('send-files', async (_event, peerId, filePaths, pin) => {
  // Find peer in discovery registry
  const devices = discovery.getDevices();
  const peer    = devices.find((d) => d.id === peerId);
  if (!peer) throw new Error('Peer not found');
  if (!filePaths || filePaths.length === 0) throw new Error('No files selected');

  try {
    await connManager.sendToPeer(peer, filePaths, pin, (fileIdx, filename, sent, total) => {
      send('progress', { peerId, fileIdx, filename, received: sent, total });
    });
    send('transfer-complete', { peerId, downloadDir: null });
  } catch (err) {
    console.error('[Main] sendToPeer error:', err.message);
    send('transfer-error', { peerId, message: err.message });
    throw err;
  }
});

/** Cancel active outgoing transfer */
ipcMain.handle('cancel-transfer', (_event, peerId) => {
  connManager.cancelTransfer(peerId);
});

/** Accept an incoming connection request */
ipcMain.handle('accept-connection', (_event, peerId) => {
  const req = pendingRequests.get(peerId);
  if (req) { req.acceptFn(); pendingRequests.delete(peerId); }
});

/** Reject an incoming connection request */
ipcMain.handle('reject-connection', (_event, peerId) => {
  const req = pendingRequests.get(peerId);
  if (req) { req.rejectFn(); pendingRequests.delete(peerId); }
});

/** (Not needed — PIN is generated server-side; just kept for protocol symmetry) */
ipcMain.handle('submit-pin', () => {});

/** Open the downloads folder in Finder/Explorer */
ipcMain.handle('open-download-dir', () => {
  shell.openPath(DOWNLOAD_DIR);
});

// ─── Helper ──────────────────────────────────────────────────────────────────

/** Send an IPC event to the renderer if the window is open */
function send(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}
