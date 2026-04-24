/**
 * preload.js
 * Secure bridge between the Electron main process and the renderer.
 * Only exposes a controlled API surface via contextBridge — no direct
 * Node access in the renderer.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lanShare', {

  // ─── Device Info ─────────────────────────────────────────────────────────

  /** Get this device's info (id, name) */
  getDeviceInfo: () => ipcRenderer.invoke('get-device-info'),

  // ─── Discovery ───────────────────────────────────────────────────────────

  onDeviceFound:   (cb) => ipcRenderer.on('device-found',   (_, d) => cb(d)),
  onDeviceUpdated: (cb) => ipcRenderer.on('device-updated', (_, d) => cb(d)),
  onDeviceLost:    (cb) => ipcRenderer.on('device-lost',    (_, id) => cb(id)),

  // ─── Connection requests ─────────────────────────────────────────────────

  /** Received an inbound connection request → show accept/reject dialog */
  onIncomingRequest: (cb) => ipcRenderer.on('incoming-request', (_, data) => cb(data)),

  /** Accept an incoming connection */
  acceptConnection: (peerId) => ipcRenderer.invoke('accept-connection', peerId),

  /** Reject an incoming connection */
  rejectConnection: (peerId) => ipcRenderer.invoke('reject-connection', peerId),

  // ─── PIN flow ─────────────────────────────────────────────────────────────

  /** Main tells renderer to display the generated PIN */
  onShowPin: (cb) => ipcRenderer.on('show-pin', (_, data) => cb(data)),

  /** Renderer submits the PIN entered by the sender */
  submitPin: (peerId, pin) => ipcRenderer.invoke('submit-pin', peerId, pin),

  // ─── File transfer ────────────────────────────────────────────────────────

  /** Open OS file picker, returns array of paths */
  pickFiles: () => ipcRenderer.invoke('pick-files'),

  /**
   * Send files to a connected peer.
   * @param {string}   peerId
   * @param {string[]} filePaths
   * @param {string}   pin       - PIN entered by sender
   */
  sendFiles: (peerId, filePaths, pin) => ipcRenderer.invoke('send-files', peerId, filePaths, pin),

  /** Cancel an ongoing outgoing transfer */
  cancelTransfer: (peerId) => ipcRenderer.invoke('cancel-transfer', peerId),

  // ─── Progress & status events ─────────────────────────────────────────────

  onProgress:          (cb) => ipcRenderer.on('progress',          (_, d) => cb(d)),
  onTransferStart:     (cb) => ipcRenderer.on('transfer-start',    (_, d) => cb(d)),
  onTransferComplete:  (cb) => ipcRenderer.on('transfer-complete', (_, d) => cb(d)),
  onTransferCancelled: (cb) => ipcRenderer.on('transfer-cancelled',(_, d) => cb(d)),
  onTransferError:     (cb) => ipcRenderer.on('transfer-error',    (_, d) => cb(d)),

  // ─── Utility ──────────────────────────────────────────────────────────────

  /** Open the OS save folder */
  openDownloadDir: () => ipcRenderer.invoke('open-download-dir'),

  /** Remove a specific IPC listener (cleanup) */
  removeListener: (channel, cb) => ipcRenderer.removeListener(channel, cb),
});
