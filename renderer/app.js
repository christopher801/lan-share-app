/**
 * app.js — Renderer process
 * Handles all UI interactions and bridges to the main process via window.lanShare.
 */

'use strict';

// ═══════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════

const state = {
  myId:        null,
  myName:      null,
  devices:     new Map(),          // id → device object
  selectedId:  null,
  files:       [],                 // File paths selected to send
  transferring: false,
  currentPeerId: null,             // Peer for pending accept/reject
};

// ═══════════════════════════════════════════════════════════════
// DOM refs
// ═══════════════════════════════════════════════════════════════

const $ = (id) => document.getElementById(id);

const DOM = {
  myDeviceName:    $('myDeviceName'),
  deviceList:      $('deviceList'),
  deviceCount:     $('deviceCount'),
  emptyState:      $('emptyState'),

  // Send panel
  noDeviceSelected:$('noDeviceSelected'),
  sendUI:          $('sendUI'),
  targetAvatar:    $('targetAvatar'),
  targetName:      $('targetName'),
  targetAddress:   $('targetAddress'),
  btnDeselect:     $('btnDeselect'),

  // File zone
  dropZone:        $('dropZone'),
  fileInput:       $('fileInput'),
  fileList:        $('fileList'),
  fileItems:       $('fileItems'),
  fileCountLabel:  $('fileCountLabel'),
  btnPickFiles:    $('btnPickFiles'),
  btnClearFiles:   $('btnClearFiles'),

  // PIN
  pinRow:          $('pinRow'),
  pinDigits:       Array.from(document.querySelectorAll('.pin-digit')),

  // Actions
  btnSend:         $('btnSend'),
  btnCancel:       $('btnCancel'),

  // Progress
  transferProgress:$('transferProgress'),
  progressLabel:   $('progressLabel'),
  progressPct:     $('progressPct'),
  progressFill:    $('progressFill'),
  progressBytes:   $('progressBytes'),
  progressFile:    $('progressFile'),

  // Overlays
  overlayIncoming: $('overlayIncoming'),
  requestPeerName: $('requestPeerName'),
  requestPeerAddress: $('requestPeerAddress'),
  btnAccept:       $('btnAccept'),
  btnReject:       $('btnReject'),

  overlayPin:      $('overlayPin'),
  pinPeerName:     $('pinPeerName'),
  pinDisplay:      $('pinDisplay'),
  btnDismissPin:   $('btnDismissPin'),

  toastStack:      $('toastStack'),
};

// ═══════════════════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════════════════

async function init() {
  const info = await window.lanShare.getDeviceInfo();
  state.myId   = info.id;
  state.myName = info.name;
  DOM.myDeviceName.textContent = info.name;

  registerIPCListeners();
  registerUIHandlers();
}

// ═══════════════════════════════════════════════════════════════
// IPC listeners (main → renderer)
// ═══════════════════════════════════════════════════════════════

function registerIPCListeners() {

  window.lanShare.onDeviceFound((device) => {
    state.devices.set(device.id, device);
    renderDeviceList();
    toast(`${device.name} joined the network`, 'info');
  });

  window.lanShare.onDeviceUpdated((device) => {
    state.devices.set(device.id, device);
    // Update address silently
  });

  window.lanShare.onDeviceLost((id) => {
    const d = state.devices.get(id);
    if (d) toast(`${d.name} left the network`, 'info');
    state.devices.delete(id);
    if (state.selectedId === id) deselectDevice();
    renderDeviceList();
  });

  // ── Incoming request ─────────────────────────────────────────
  window.lanShare.onIncomingRequest(({ peerId, peerName, peerAddress }) => {
    state.currentPeerId = peerId;
    DOM.requestPeerName.textContent    = peerName;
    DOM.requestPeerAddress.textContent = peerAddress;
    DOM.overlayIncoming.style.display  = 'flex';
  });

  // ── Show PIN (receiver side) ──────────────────────────────────
  window.lanShare.onShowPin(({ peerId, peerName, pin }) => {
    DOM.overlayIncoming.style.display = 'none'; // close request modal
    DOM.pinPeerName.textContent  = peerName;
    DOM.pinDisplay.textContent   = pin;
    DOM.overlayPin.style.display = 'flex';
  });

  // ── Transfer events ───────────────────────────────────────────
  window.lanShare.onTransferStart(({ peerId, peerName }) => {
    DOM.overlayPin.style.display = 'none';
    state.transferring = true;
    showProgress(true);
    DOM.progressLabel.textContent = peerName
      ? `Receiving from ${peerName}…`
      : `Sending…`;
    DOM.btnCancel.style.display = 'inline-flex';
    DOM.btnSend.style.display   = 'none';
    toast('Transfer started', 'info');
  });

  window.lanShare.onProgress(({ peerId, fileIdx, filename, received, total }) => {
    const pct  = total > 0 ? Math.round((received / total) * 100) : 0;
    DOM.progressFill.style.width    = `${pct}%`;
    DOM.progressPct.textContent     = `${pct}%`;
    DOM.progressBytes.textContent   = `${formatBytes(received)} / ${formatBytes(total)}`;
    DOM.progressFile.textContent    = filename;
    DOM.progressLabel.textContent   = `File ${fileIdx + 1}: ${filename}`;
  });

  window.lanShare.onTransferComplete(({ peerId, downloadDir }) => {
    state.transferring = false;
    showProgress(false);
    resetSendUI();
    toast(
      downloadDir
        ? `Files saved to LAN Share Downloads`
        : 'Files sent successfully!',
      'success'
    );
    if (downloadDir) {
      // Offer to open folder
      const t = createToast('📂 Click to open Downloads folder', 'info', 6000);
      t.style.cursor = 'pointer';
      t.addEventListener('click', () => window.lanShare.openDownloadDir());
    }
  });

  window.lanShare.onTransferCancelled(({ peerId }) => {
    state.transferring = false;
    showProgress(false);
    resetSendUI();
    toast('Transfer cancelled', 'error');
  });

  window.lanShare.onTransferError(({ peerId, message }) => {
    state.transferring = false;
    showProgress(false);
    resetSendUI();
    toast(`Transfer failed: ${message}`, 'error');
  });
}

// ═══════════════════════════════════════════════════════════════
// UI event handlers
// ═══════════════════════════════════════════════════════════════

function registerUIHandlers() {

  // ── Deselect device ───────────────────────────────────────────
  DOM.btnDeselect.addEventListener('click', deselectDevice);

  // ── File picker button ────────────────────────────────────────
  DOM.btnPickFiles.addEventListener('click', async () => {
    const paths = await window.lanShare.pickFiles();
    if (paths.length) addFiles(paths);
  });

  DOM.fileInput.addEventListener('change', () => {
    // We use the native OS picker via IPC; this input is for drag-drop label
  });

  DOM.btnClearFiles.addEventListener('click', clearFiles);

  // ── Drag & drop ───────────────────────────────────────────────
  DOM.dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    DOM.dropZone.classList.add('drag-over');
  });

  DOM.dropZone.addEventListener('dragleave', () => {
    DOM.dropZone.classList.remove('drag-over');
  });

  DOM.dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    DOM.dropZone.classList.remove('drag-over');
    const paths = Array.from(e.dataTransfer.files).map((f) => f.path);
    if (paths.length) addFiles(paths);
  });

  // ── PIN digits ────────────────────────────────────────────────
  DOM.pinDigits.forEach((input, i) => {
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(-1);
      if (input.value && i < 3) DOM.pinDigits[i + 1].focus();
      updateSendButton();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !input.value && i > 0) {
        DOM.pinDigits[i - 1].focus();
      }
    });

    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
      if (text.length === 4) {
        DOM.pinDigits.forEach((d, j) => { d.value = text[j] || ''; });
        DOM.pinDigits[3].focus();
        updateSendButton();
      }
    });
  });

  // ── Send ──────────────────────────────────────────────────────
  DOM.btnSend.addEventListener('click', async () => {
    if (!state.selectedId || !state.files.length) return;

    const pin = DOM.pinDigits.map((d) => d.value).join('');
    if (pin.length !== 4) { toast('Please enter the full 4-digit PIN', 'error'); return; }

    DOM.btnSend.disabled = true;
    state.transferring   = true;
    showProgress(true);
    DOM.btnCancel.style.display = 'inline-flex';
    DOM.progressLabel.textContent = 'Connecting…';

    try {
      await window.lanShare.sendFiles(state.selectedId, state.files, pin);
    } catch (err) {
      // Errors are surfaced via onTransferError IPC too, but handle locally too
      toast(`Error: ${err.message}`, 'error');
      state.transferring = false;
      showProgress(false);
      DOM.btnSend.disabled = false;
      DOM.btnCancel.style.display = 'none';
    }
  });

  // ── Cancel ────────────────────────────────────────────────────
  DOM.btnCancel.addEventListener('click', () => {
    if (state.selectedId) window.lanShare.cancelTransfer(state.selectedId);
    DOM.btnCancel.style.display = 'none';
  });

  // ── Accept incoming ───────────────────────────────────────────
  DOM.btnAccept.addEventListener('click', () => {
    if (!state.currentPeerId) return;
    window.lanShare.acceptConnection(state.currentPeerId);
    DOM.overlayIncoming.style.display = 'none';
  });

  DOM.btnReject.addEventListener('click', () => {
    if (!state.currentPeerId) return;
    window.lanShare.rejectConnection(state.currentPeerId);
    DOM.overlayIncoming.style.display = 'none';
    toast('Connection rejected', 'info');
  });

  // ── Dismiss PIN display ───────────────────────────────────────
  DOM.btnDismissPin.addEventListener('click', () => {
    DOM.overlayPin.style.display = 'none';
  });
}

// ═══════════════════════════════════════════════════════════════
// Device list rendering
// ═══════════════════════════════════════════════════════════════

function renderDeviceList() {
  const devices = Array.from(state.devices.values());
  DOM.deviceCount.textContent = devices.length;

  if (devices.length === 0) {
    DOM.emptyState.style.display = 'flex';
    // Remove any device cards
    Array.from(DOM.deviceList.querySelectorAll('.device-card')).forEach(el => el.remove());
    return;
  }

  DOM.emptyState.style.display = 'none';

  // Build a set of current ids
  const existing = new Set(
    Array.from(DOM.deviceList.querySelectorAll('.device-card')).map(el => el.dataset.id)
  );

  // Add new ones
  devices.forEach((device) => {
    if (!existing.has(device.id)) {
      const card = buildDeviceCard(device);
      DOM.deviceList.appendChild(card);
    } else {
      // Update name/address on existing card
      const card = DOM.deviceList.querySelector(`.device-card[data-id="${device.id}"]`);
      if (card) {
        card.querySelector('small').textContent = device.address;
      }
    }
  });

  // Remove gone ones
  existing.forEach((id) => {
    if (!state.devices.has(id)) {
      const el = DOM.deviceList.querySelector(`.device-card[data-id="${id}"]`);
      if (el) el.remove();
    }
  });
}

function buildDeviceCard(device) {
  const card = document.createElement('div');
  card.className = 'device-card';
  card.dataset.id = device.id;
  if (state.selectedId === device.id) card.classList.add('selected');

  const { bg, emoji } = avatarStyle(device.name);
  const platform = platformIcon(device.platform);

  card.innerHTML = `
    <div class="device-avatar" style="background:${bg}">${emoji}</div>
    <div class="device-info">
      <strong>${escapeHtml(device.name)}</strong>
      <small>${device.address}</small>
    </div>
    <div class="device-platform">${platform}</div>
  `;

  card.addEventListener('click', () => selectDevice(device));
  return card;
}

// ═══════════════════════════════════════════════════════════════
// Device selection
// ═══════════════════════════════════════════════════════════════

function selectDevice(device) {
  state.selectedId = device.id;

  // Update cards
  DOM.deviceList.querySelectorAll('.device-card').forEach((c) => {
    c.classList.toggle('selected', c.dataset.id === device.id);
  });

  // Show send UI
  DOM.noDeviceSelected.style.display = 'none';
  DOM.sendUI.style.display           = 'flex';

  const { bg, emoji } = avatarStyle(device.name);
  DOM.targetAvatar.style.background = bg;
  DOM.targetAvatar.textContent      = emoji;
  DOM.targetName.textContent        = device.name;
  DOM.targetAddress.textContent     = `${device.address}:${device.tcpPort}`;

  // Show PIN row
  DOM.pinRow.style.display = 'flex';

  updateSendButton();
}

function deselectDevice() {
  state.selectedId = null;
  DOM.deviceList.querySelectorAll('.device-card').forEach(c => c.classList.remove('selected'));
  DOM.sendUI.style.display           = 'none';
  DOM.noDeviceSelected.style.display = 'flex';
}

// ═══════════════════════════════════════════════════════════════
// File management
// ═══════════════════════════════════════════════════════════════

function addFiles(paths) {
  // Deduplicate
  const existing = new Set(state.files);
  paths.forEach(p => existing.add(p));
  state.files = Array.from(existing);

  renderFileList();
  updateSendButton();
}

function clearFiles() {
  state.files = [];
  renderFileList();
  updateSendButton();
}

function renderFileList() {
  if (state.files.length === 0) {
    DOM.fileList.style.display = 'none';
    return;
  }

  DOM.fileList.style.display   = 'block';
  DOM.fileCountLabel.textContent = `${state.files.length} file${state.files.length > 1 ? 's' : ''}`;
  DOM.fileItems.innerHTML = '';

  state.files.forEach((fp) => {
    const name = fp.split(/[\\/]/).pop();
    const ext  = name.split('.').pop().toLowerCase();
    const icon = fileIcon(ext);
    const div  = document.createElement('div');
    div.className = 'file-item';
    div.innerHTML = `
      <span class="file-icon">${icon}</span>
      <div class="file-meta">
        <strong title="${escapeHtml(fp)}">${escapeHtml(name)}</strong>
        <small class="mono">${escapeHtml(fp)}</small>
      </div>
    `;
    DOM.fileItems.appendChild(div);
  });
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function updateSendButton() {
  const pin    = DOM.pinDigits.map(d => d.value).join('');
  const ready  = state.selectedId && state.files.length > 0 && pin.length === 4 && !state.transferring;
  DOM.btnSend.disabled = !ready;
}

function showProgress(show) {
  DOM.transferProgress.style.display = show ? 'flex' : 'none';
  if (!show) {
    DOM.progressFill.style.width  = '0%';
    DOM.progressPct.textContent   = '0%';
    DOM.progressBytes.textContent = '';
    DOM.progressFile.textContent  = '';
    DOM.progressLabel.textContent = 'Preparing…';
  }
}

function resetSendUI() {
  DOM.btnSend.style.display   = 'inline-flex';
  DOM.btnSend.disabled        = true;
  DOM.btnCancel.style.display = 'none';
  clearFiles();
  DOM.pinDigits.forEach(d => d.value = '');
  updateSendButton();
}

// ── Toast ──────────────────────────────────────────────────────

function createToast(msg, type = 'info', duration = 3500) {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  DOM.toastStack.appendChild(el);
  setTimeout(() => {
    el.classList.add('removing');
    setTimeout(() => el.remove(), 250);
  }, duration);
  return el;
}

function toast(msg, type = 'info', duration = 3500) {
  createToast(msg, type, duration);
}

// ── Formatting ──────────────────────────────────────────────────

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Visual helpers ──────────────────────────────────────────────

const AVATAR_COLORS = [
  ['#1e3a5f','💻'],['#1a3a2e','🖥️'],['#3a1e5f','🖱️'],
  ['#5f3a1e','📱'],['#1e5f3a','⌨️'],['#5f1e3a','🖨️'],
];

function avatarStyle(name) {
  const idx  = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length;
  const [bg, emoji] = AVATAR_COLORS[idx];
  return { bg, emoji };
}

function platformIcon(platform) {
  if (platform === 'win32')  return '🪟';
  if (platform === 'darwin') return '🍎';
  return '🐧';
}

function fileIcon(ext) {
  const map = {
    jpg:'🖼️', jpeg:'🖼️', png:'🖼️', gif:'🖼️', webp:'🖼️', svg:'🖼️',
    mp4:'🎬', mkv:'🎬', mov:'🎬', avi:'🎬',
    mp3:'🎵', wav:'🎵', flac:'🎵', ogg:'🎵',
    pdf:'📄', doc:'📝', docx:'📝', xls:'📊', xlsx:'📊', ppt:'📋', pptx:'📋',
    zip:'🗜️', rar:'🗜️', tar:'🗜️', gz:'🗜️', '7z':'🗜️',
    js:'🟨', ts:'🔷', py:'🐍', html:'🌐', css:'🎨', json:'📋',
    txt:'📃', md:'📃',
  };
  return map[ext] || '📁';
}

// ═══════════════════════════════════════════════════════════════
// Bootstrap
// ═══════════════════════════════════════════════════════════════

init().catch((err) => {
  console.error('Init failed:', err);
  toast('Initialization error: ' + err.message, 'error');
});
