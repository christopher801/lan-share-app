/**
 * discovery.js
 * UDP broadcast discovery — finds other LAN Share peers on the local network.
 *
 * Protocol:
 *   Every peer broadcasts a JSON beacon every BROADCAST_INTERVAL ms on
 *   UDP port DISCOVERY_PORT (bound to 0.0.0.0 to receive broadcasts too).
 *
 *   Beacon format:
 *   { type: 'LANSHARE_BEACON', id, name, tcpPort, platform, version }
 *
 *   Any peer that receives a beacon (from a different id) adds/updates it
 *   in the device registry and emits 'device-found' or 'device-updated'.
 *
 *   Devices that haven't sent a beacon for TIMEOUT_MS are considered gone
 *   and 'device-lost' is emitted.
 */

const dgram    = require('dgram');
const os       = require('os');
const EventEmitter = require('events');
const { generateSessionId } = require('./encryption');

const DISCOVERY_PORT     = 45678;       // UDP port for discovery beacons
const BROADCAST_ADDR     = '255.255.255.255';
const BROADCAST_INTERVAL = 3_000;       // ms between beacons
const TIMEOUT_MS         = 10_000;      // ms before a device is considered lost
const APP_VERSION        = '1.0.0';

class Discovery extends EventEmitter {
  constructor(deviceName, tcpPort) {
    super();

    this.id       = generateSessionId();          // unique per app launch
    this.name     = deviceName || _defaultName(); // human-readable label
    this.tcpPort  = tcpPort;
    this.platform = process.platform;

    this.devices  = new Map();  // id → { id, name, address, tcpPort, platform, lastSeen }
    this.socket   = null;
    this._broadcastTimer = null;
    this._cleanupTimer   = null;
    this.running  = false;
  }

  /** Start listening + broadcasting */
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

  /** Stop everything */
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

  /** Return current device list as array */
  getDevices() {
    return Array.from(this.devices.values());
  }

  // ─── Private ─────────────────────────────────────────────────────────────

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
      this.socket.send(msg, 0, msg.length, DISCOVERY_PORT, BROADCAST_ADDR, (err) => {
        if (err) console.warn('[Discovery] Broadcast send error:', err.message);
      });
    };
    send(); // immediate first broadcast
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
      return; // ignore malformed packets
    }

    if (packet.type !== 'LANSHARE_BEACON') return;
    if (packet.id === this.id) return;            // ignore own broadcasts

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

module.exports = Discovery;
