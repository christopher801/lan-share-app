/**
 * app.js — Renderer
 * Flou Zender-style: wè aparèy → chwazi fichye → voye → resevwa aksepte → fini
 * Pa gen PIN, pa gen etap siplemantè.
 */

'use strict';

const state = {
  myId:         null,
  myName:       null,
  devices:      new Map(),
  selectedId:   null,
  files:        [],
  transferring: false,
  currentPeerId: null,
};

const $ = (id) => document.getElementById(id);

const DOM = {
  myDeviceName:     $('myDeviceName'),
  deviceList:       $('deviceList'),
  deviceCount:      $('deviceCount'),
  emptyState:       $('emptyState'),

  noDeviceSelected: $('noDeviceSelected'),
  sendUI:           $('sendUI'),
  targetAvatar:     $('targetAvatar'),
  targetName:       $('targetName'),
  targetAddress:    $('targetAddress'),
  btnDeselect:      $('btnDeselect'),

  dropZone:         $('dropZone'),
  fileInput:        $('fileInput'),
  fileList:         $('fileList'),
  fileItems:        $('fileItems'),
  fileCountLabel:   $('fileCountLabel'),
  btnPickFiles:     $('btnPickFiles'),
  btnClearFiles:    $('btnClearFiles'),

  btnSend:          $('btnSend'),
  btnCancel:        $('btnCancel'),

  transferProgress: $('transferProgress'),
  progressLabel:    $('progressLabel'),
  progressPct:      $('progressPct'),
  progressFill:     $('progressFill'),
  progressBytes:    $('progressBytes'),
  progressFile:     $('progressFile'),

  overlayIncoming:  $('overlayIncoming'),
  requestPeerName:  $('requestPeerName'),
  requestPeerAddress: $('requestPeerAddress'),
  fileSummary:      $('fileSummary'),
  btnAccept:        $('btnAccept'),
  btnReject:        $('btnReject'),

  toastStack:       $('toastStack'),
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
// IPC listeners
// ═══════════════════════════════════════════════════════════════

function registerIPCListeners() {

  window.lanShare.onDeviceFound((device) => {
    state.devices.set(device.id, device);
    renderDeviceList();
    toast(`${device.name} sou rezo a`, 'info');
  });

  window.lanShare.onDeviceUpdated((device) => {
    state.devices.set(device.id, device);
  });

  window.lanShare.onDeviceLost((id) => {
    const d = state.devices.get(id);
    if (d) toast(`${d.name} kite rezo a`, 'info');
    state.devices.delete(id);
    if (state.selectedId === id) deselectDevice();
    renderDeviceList();
  });

  // ── Demann antran (resevwa) ────────────────────────────────────
  window.lanShare.onIncomingRequest(({ peerId, peerName, peerAddress, fileCount, totalSize, files }) => {
    state.currentPeerId = peerId;
    DOM.requestPeerName.textContent    = peerName;
    DOM.requestPeerAddress.textContent = peerAddress;

    // Montre lis fichye nan modal
    DOM.fileSummary.innerHTML = '';
    if (files && files.length) {
      files.forEach(f => {
        const row = document.createElement('div');
        row.className = 'summary-row';
        row.innerHTML = `
          <span>${fileIcon(f.name.split('.').pop().toLowerCase())} ${escapeHtml(f.name)}</span>
          <span class="mono muted">${formatBytes(f.size)}</span>
        `;
        DOM.fileSummary.appendChild(row);
      });
    }

    // Total
    const total = document.createElement('div');
    total.className = 'summary-total';
    total.innerHTML = `<span>${fileCount} fichye</span><span class="mono">${formatBytes(totalSize)}</span>`;
    DOM.fileSummary.appendChild(total);

    DOM.overlayIncoming.style.display = 'flex';
  });

  // ── Transfè ────────────────────────────────────────────────────
  window.lanShare.onTransferStart(({ peerId, peerName }) => {
    state.transferring = true;
    DOM.overlayIncoming.style.display = 'none';
    showProgress(true);
    DOM.progressLabel.textContent = peerName ? `Ap resevwa depi ${peerName}…` : `Ap voye…`;
    DOM.btnCancel.style.display = 'inline-flex';
    DOM.btnSend.style.display   = 'none';
  });

  window.lanShare.onProgress(({ fileIdx, filename, received, total }) => {
    const pct = total > 0 ? Math.round((received / total) * 100) : 0;
    DOM.progressFill.style.width  = `${pct}%`;
    DOM.progressPct.textContent   = `${pct}%`;
    DOM.progressBytes.textContent = `${formatBytes(received)} / ${formatBytes(total)}`;
    DOM.progressFile.textContent  = filename;
    DOM.progressLabel.textContent = `Fichye ${fileIdx + 1}: ${filename}`;
  });

  window.lanShare.onTransferComplete(({ downloadDir }) => {
    state.transferring = false;
    showProgress(false);
    resetSendUI();
    if (downloadDir) {
      toast('✅ Fichye resevwa!', 'success');
      const t = createToast('📂 Klike pou ouvri dosye a', 'info', 7000);
      t.style.cursor = 'pointer';
      t.addEventListener('click', () => window.lanShare.openDownloadDir());
    } else {
      toast('✅ Fichye voye avèk siksè!', 'success');
    }
  });

  window.lanShare.onTransferCancelled(() => {
    state.transferring = false;
    showProgress(false);
    resetSendUI();
    toast('Transfè anile', 'error');
  });

  window.lanShare.onTransferError(({ message }) => {
    state.transferring = false;
    showProgress(false);
    resetSendUI();
    toast(`Erè: ${message}`, 'error');
  });
}

// ═══════════════════════════════════════════════════════════════
// UI handlers
// ═══════════════════════════════════════════════════════════════

function registerUIHandlers() {

  DOM.btnDeselect.addEventListener('click', deselectDevice);

  DOM.btnPickFiles.addEventListener('click', async () => {
    const paths = await window.lanShare.pickFiles();
    if (paths.length) addFiles(paths);
  });

  DOM.btnClearFiles.addEventListener('click', clearFiles);

  // Drag & drop
  DOM.dropZone.addEventListener('dragover',  (e) => { e.preventDefault(); DOM.dropZone.classList.add('drag-over'); });
  DOM.dropZone.addEventListener('dragleave', ()  => DOM.dropZone.classList.remove('drag-over'));
  DOM.dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    DOM.dropZone.classList.remove('drag-over');
    const paths = Array.from(e.dataTransfer.files).map(f => f.path);
    if (paths.length) addFiles(paths);
  });

  // Voye — san PIN
  DOM.btnSend.addEventListener('click', async () => {
    if (!state.selectedId || !state.files.length || state.transferring) return;

    DOM.btnSend.disabled = true;
    state.transferring   = true;
    showProgress(true);
    DOM.progressLabel.textContent = 'Ap konekte…';
    DOM.btnCancel.style.display   = 'inline-flex';

    try {
      await window.lanShare.sendFiles(state.selectedId, state.files);
    } catch (err) {
      toast(`Erè: ${err.message}`, 'error');
      state.transferring = false;
      showProgress(false);
      DOM.btnSend.disabled = false;
      DOM.btnCancel.style.display = 'none';
    }
  });

  DOM.btnCancel.addEventListener('click', () => {
    if (state.selectedId) window.lanShare.cancelTransfer(state.selectedId);
    DOM.btnCancel.style.display = 'none';
  });

  // Modal aksepte/rejte
  DOM.btnAccept.addEventListener('click', () => {
    if (!state.currentPeerId) return;
    window.lanShare.acceptConnection(state.currentPeerId);
    DOM.overlayIncoming.style.display = 'none';
  });

  DOM.btnReject.addEventListener('click', () => {
    if (!state.currentPeerId) return;
    window.lanShare.rejectConnection(state.currentPeerId);
    DOM.overlayIncoming.style.display = 'none';
    toast('Koneksyon rejte', 'info');
  });
}

// ═══════════════════════════════════════════════════════════════
// Device list
// ═══════════════════════════════════════════════════════════════

function renderDeviceList() {
  const devices = Array.from(state.devices.values());
  DOM.deviceCount.textContent = devices.length;

  if (devices.length === 0) {
    DOM.emptyState.style.display = 'flex';
    DOM.deviceList.querySelectorAll('.device-card').forEach(el => el.remove());
    return;
  }
  DOM.emptyState.style.display = 'none';

  const existing = new Set(
    Array.from(DOM.deviceList.querySelectorAll('.device-card')).map(el => el.dataset.id)
  );

  devices.forEach(device => {
    if (!existing.has(device.id)) {
      DOM.deviceList.appendChild(buildDeviceCard(device));
    }
  });

  existing.forEach(id => {
    if (!state.devices.has(id)) {
      DOM.deviceList.querySelector(`.device-card[data-id="${id}"]`)?.remove();
    }
  });
}

function buildDeviceCard(device) {
  const card = document.createElement('div');
  card.className  = 'device-card';
  card.dataset.id = device.id;
  if (state.selectedId === device.id) card.classList.add('selected');

  const { bg, initials } = avatarStyle(device.name);
  const platform = platformIcon(device.platform);

  card.innerHTML = `
    <div class="device-avatar" style="background:${bg}">${initials}</div>
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
  DOM.deviceList.querySelectorAll('.device-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.id === device.id);
  });

  DOM.noDeviceSelected.style.display = 'none';
  DOM.sendUI.style.display           = 'flex';

  const { bg, initials } = avatarStyle(device.name);
  DOM.targetAvatar.style.background = bg;
  DOM.targetAvatar.textContent      = initials;
  DOM.targetName.textContent        = device.name;
  DOM.targetAddress.textContent     = `${device.address}:${device.tcpPort}`;

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
  if (!state.files.length) {
    DOM.fileList.style.display = 'none';
    return;
  }
  DOM.fileList.style.display     = 'block';
  DOM.fileCountLabel.textContent = `${state.files.length} fichye`;
  DOM.fileItems.innerHTML        = '';

  state.files.forEach(fp => {
    const name = fp.split(/[\\/]/).pop();
    const ext  = name.split('.').pop().toLowerCase();
    const div  = document.createElement('div');
    div.className = 'file-item';
    div.innerHTML = `
      <span class="file-icon">${fileIcon(ext)}</span>
      <div class="file-meta">
        <strong title="${escapeHtml(fp)}">${escapeHtml(name)}</strong>
        <small class="mono muted">${escapeHtml(fp)}</small>
      </div>
    `;
    DOM.fileItems.appendChild(div);
  });
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function updateSendButton() {
  DOM.btnSend.disabled = !(state.selectedId && state.files.length > 0 && !state.transferring);
}

function showProgress(show) {
  DOM.transferProgress.style.display = show ? 'flex' : 'none';
  if (!show) {
    DOM.progressFill.style.width  = '0%';
    DOM.progressPct.textContent   = '0%';
    DOM.progressBytes.textContent = '';
    DOM.progressFile.textContent  = '';
    DOM.progressLabel.textContent = 'Ap prepare…';
  }
}

function resetSendUI() {
  DOM.btnSend.style.display   = 'inline-flex';
  DOM.btnSend.disabled        = true;
  DOM.btnCancel.style.display = 'none';
  clearFiles();
  updateSendButton();
}

// Toasts
function createToast(msg, type = 'info', duration = 3500) {
  const el = document.createElement('div');
  el.className   = `toast toast-${type}`;
  el.textContent = msg;
  DOM.toastStack.appendChild(el);
  setTimeout(() => {
    el.classList.add('removing');
    setTimeout(() => el.remove(), 250);
  }, duration);
  return el;
}
function toast(msg, type = 'info', dur = 3500) { createToast(msg, type, dur); }

// Formatting
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Initials pou avatar (tankou Zender)
function avatarStyle(name) {
  const colors = ['#1e3a8a','#065f46','#4c1d95','#7c2d12','#164e63','#1e1b4b'];
  const idx    = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % colors.length;
  const parts  = name.trim().split(/\s+/);
  const initials = parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
  return { bg: colors[idx], initials };
}

function platformIcon(platform) {
  if (platform === 'win32')  return '🪟';
  if (platform === 'darwin') return '🍎';
  return '🐧';
}

function fileIcon(ext) {
  const map = {
    jpg:'🖼️',jpeg:'🖼️',png:'🖼️',gif:'🖼️',webp:'🖼️',svg:'🖼️',
    mp4:'🎬',mkv:'🎬',mov:'🎬',avi:'🎬',
    mp3:'🎵',wav:'🎵',flac:'🎵',ogg:'🎵',
    pdf:'📄',doc:'📝',docx:'📝',xls:'📊',xlsx:'📊',ppt:'📋',pptx:'📋',
    zip:'🗜️',rar:'🗜️',tar:'🗜️',gz:'🗜️','7z':'🗜️',
    js:'🟨',ts:'🔷',py:'🐍',html:'🌐',css:'🎨',json:'📋',
    txt:'📃',md:'📃',
  };
  return map[ext] || '📁';
}

// Bootstrap
init().catch(err => {
  console.error('Init failed:', err);
  toast('Erè: ' + err.message, 'error');
});
