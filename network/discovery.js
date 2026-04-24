/**
 * discovery.js — FIXED VERSION
 * Timeout 30s + multi-interface broadcast (fix Windows Firewall)
 */

const dgram        = require('dgram');
const os           = require('os');
const EventEmitter = require('events');
const { generateSessionId } = require('./encryption');

const DISCOVERY_PORT     = 45678;
const BROADCAST_ADDR     = '255.255.255.255';
const BROADCAST_INTERVAL = 3_000;
const TIMEOUT_MS         = 30_000;   // ← 10_000 → 30_000
const APP_VERSION        = '1.0.0';

class Discovery extends EventEmitter {
  constructor(deviceName, tcpPort) {
    super();
    this.id       = generateSessionId();
    this.name     = deviceName || _defaultName();
    this.tcpPort  = tcpPort;
    this.platform = process.platform;
    this.devices  = new Map();
    this.socket   = null;
    this._broadcastTimer = null;
    this._cleanupTimer   = null;
    this.running  = false;
  }

  start() {
    if (this.running) return;
    this.running = true;

    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    this.socket.on('error', (err) => {
      console.error('[Discovery] UDP error:', err.message);
      this.emit('error', err);
    });

    this.socket.on('message', (msg, rinfo) => {
      this._handleMessage(msg, rinfo);
    });

    this.socket.bind(DISCOVERY_PORT, () => {
      try {
        this.socket.setBroadcast(true);
      } catch (e) {
        console.warn('[Discovery] setBroadcast failed:', e.message);
      }
      console.log(`[Discovery] Listening on UDP :${DISCOVERY_PORT}`);
      this._startBroadcasting();
      this._startCleanup();
    });
  }

  stop() {
    this.running = false;
    clearInterval(this._broadcastTimer);
    clearInterval(this._cleanupTimer);
    if (this.socket) {
      try { this.socket.close(); } catch (_) {}
      this.socket = null;
    }
    this.devices.clear();
  }

  getDevices() {
    return Array.from(this.devices.values());
  }

  _buildBeacon() {
    return JSON.stringify({
      type:     'LANSHARE_BEACON',
      id:       this.id,
      name:     this.name,
      tcpPort:  this.tcpPort,
      platform: this.platform,
      version:  APP_VERSION,
    });
  }

  _startBroadcasting() {
    const send = () => {
      if (!this.socket || !this.running) return;
      const msg = Buffer.from(this._buildBeacon());

      // 1. Broadcast global
      this.socket.send(msg, 0, msg.length, DISCOVERY_PORT, BROADCAST_ADDR, (err) => {
        if (err) console.warn('[Discovery] Broadcast 255.255.255.255 error:', err.message);
      });

      // 2. Broadcast sou chak subnet aktif (fix Windows Firewall)
      for (const addr of _getSubnetBroadcasts()) {
        this.socket.send(msg, 0, msg.length, DISCOVERY_PORT, addr, (err) => {
          if (err) console.warn(`[Discovery] Broadcast ${addr} error:`, err.message);
        });
      }
    };

    send();
    this._broadcastTimer = setInterval(send, BROADCAST_INTERVAL);
  }

  _startCleanup() {
    this._cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, device] of this.devices) {
        if (now - device.lastSeen > TIMEOUT_MS) {
          this.devices.delete(id);
          this.emit('device-lost', id);
          console.log(`[Discovery] Device lost: ${device.name} (${id})`);
        }
      }
    }, TIMEOUT_MS / 2);
  }

  _handleMessage(msg, rinfo) {
    let packet;
    try {
      packet = JSON.parse(msg.toString());
    } catch (_) {
      return;
    }

    if (packet.type !== 'LANSHARE_BEACON') return;
    if (packet.id === this.id) return;

    const existing = this.devices.get(packet.id);
    const device = {
      id:       packet.id,
      name:     packet.name,
      address:  rinfo.address,
      tcpPort:  packet.tcpPort,
      platform: packet.platform,
      version:  packet.version,
      lastSeen: Date.now(),
    };

    this.devices.set(packet.id, device);

    if (!existing) {
      console.log(`[Discovery] Device found: ${device.name} @ ${device.address}`);
      this.emit('device-found', device);
    } else {
      this.emit('device-updated', device);
    }
  }
}

function _defaultName() {
  return `${os.userInfo().username}@${os.hostname()}`;
}

function _getSubnetBroadcasts() {
  const results = [];
  try {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const iface of ifaces[name]) {
        if (iface.family !== 'IPv4' && iface.family !== 4) continue;
        if (iface.internal)  continue;
        if (!iface.netmask)  continue;

        const ip   = iface.address.split('.').map(Number);
        const mask = iface.netmask.split('.').map(Number);
        const bc   = ip.map((b, i) => (b | (~mask[i] & 0xFF)));
        const addr = bc.join('.');

        if (addr !== '255.255.255.255') {
          results.push(addr);
          console.log(`[Discovery] Interface ${name}: ${iface.address} → broadcast ${addr}`);
        }
      }
    }
  } catch (e) {
    console.warn('[Discovery] _getSubnetBroadcasts error:', e.message);
  }
  return results;
}

module.exports = Discovery;