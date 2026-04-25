/**
 * preload.js — Context bridge
 * Retire tout PIN logic, flou Zender-style
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lanShare', {

  getDeviceInfo: () => ipcRenderer.invoke('get-device-info'),

  // Discovery
  onDeviceFound:   (cb) => ipcRenderer.on('device-found',   (_, d)  => cb(d)),
  onDeviceUpdated: (cb) => ipcRenderer.on('device-updated', (_, d)  => cb(d)),
  onDeviceLost:    (cb) => ipcRenderer.on('device-lost',    (_, id) => cb(id)),

  // Incoming request (resevwa)
  onIncomingRequest: (cb) => ipcRenderer.on('incoming-request', (_, data) => cb(data)),
  acceptConnection:  (peerId) => ipcRenderer.invoke('accept-connection', peerId),
  rejectConnection:  (peerId) => ipcRenderer.invoke('reject-connection', peerId),

  // Fichye
  pickFiles:      ()                        => ipcRenderer.invoke('pick-files'),
  sendFiles:      (peerId, filePaths)       => ipcRenderer.invoke('send-files', peerId, filePaths),
  cancelTransfer: (peerId)                  => ipcRenderer.invoke('cancel-transfer', peerId),
  openDownloadDir:()                        => ipcRenderer.invoke('open-download-dir'),

  // Evènman transfè
  onTransferStart:     (cb) => ipcRenderer.on('transfer-start',     (_, d) => cb(d)),
  onProgress:          (cb) => ipcRenderer.on('progress',           (_, d) => cb(d)),
  onTransferComplete:  (cb) => ipcRenderer.on('transfer-complete',  (_, d) => cb(d)),
  onTransferCancelled: (cb) => ipcRenderer.on('transfer-cancelled', (_, d) => cb(d)),
  onTransferError:     (cb) => ipcRenderer.on('transfer-error',     (_, d) => cb(d)),
});
