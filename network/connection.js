/**
 * connection.js
 * Flou Zender-style — san PIN, san etap konplèks.
 *
 * Handshake:
 *   Sender → Receiver:  HELLO { id, name, fileCount, totalSize, files[] }
 *   Receiver → Sender:  HELLO_ACK { accepted: true/false }
 *   Si accepted: Sender voye [secret(16 bytes) + salt(16 bytes)] framed
 *   Receiver derive menm kle a → transfè kòmanse
 *
 * Chifraj AES-256-CBC toujou aktif — itilizatè pa wè li.
 */

const net  = require('net');
const os   = require('os');
const path = require('path');
const fs   = require('fs');
const EventEmitter = require('events');
const { deriveKey, generateSalt, generateSessionId } = require('./encryption');
const { frameJSON, FrameParser, sendFiles, receiveFiles } = require('./fileTransfer');

const HANDSHAKE_TIMEOUT = 60_000;

class ConnectionManager extends EventEmitter {
  constructor(opts) {
    super();
    this.id          = opts.id;
    this.name        = opts.name;
    this.downloadDir = opts.downloadDir || os.homedir();
    this.onIncomingRequest = opts.onIncomingRequest;

    this._server = null;
    this._port   = null;
    this._active = new Map();
  }

  // ─── TCP Server ────────────────────────────────────────────────

  startServer() {
    return new Promise((resolve, reject) => {
      this._server = net.createServer((socket) => this._handleIncoming(socket));
      this._server.listen(0, '0.0.0.0', () => {
        this._port = this._server.address().port;
        console.log(`[Connection] TCP server listening on :${this._port}`);
        resolve(this._port);
      });
      this._server.on('error', reject);
    });
  }

  get port() { return this._port; }

  stopServer() {
    if (this._server) { this._server.close(); this._server = null; }
    this._active.clear();
  }

  // ─── Sender ────────────────────────────────────────────────────

  sendToPeer(peer, filePaths, onProgress) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(
        { host: peer.address, port: peer.tcpPort },
        () => console.log(`[Connection] Connected to ${peer.name} @ ${peer.address}:${peer.tcpPort}`)
      );

      socket.on('error', (err) => {
        this._active.delete(peer.id);
        reject(err);
      });

      const parser    = new FrameParser();
      const cancelRef = { cancelled: false };
      this._active.set(peer.id, { socket, cancelRef });
      socket.on('data', (d) => parser.push(d));

      // Metadata fichye yo
      const fileMeta  = filePaths.map(fp => ({
        name: path.basename(fp),
        size: (() => { try { return fs.statSync(fp).size; } catch (_) { return 0; } })(),
      }));
      const totalSize = fileMeta.reduce((s, f) => s + f.size, 0);

      socket.once('connect', () => {
        socket.write(frameJSON({
          type:      'HELLO',
          id:        this.id,
          name:      this.name,
          fileCount: filePaths.length,
          totalSize,
          files:     fileMeta,
        }));
      });

      parser.on('frame', async (frame) => {
        try {
          const msg = _tryParseJSON(frame);
          if (!msg || msg.type !== 'HELLO_ACK') return;

          if (!msg.accepted) {
            socket.destroy();
            this._active.delete(peer.id);
            return reject(new Error('Rejte pa resevwa a'));
          }

          // Jenere secret + salt, derive kle, voye [secret|salt] framed
          const secret = generateSalt(); // 16 bytes random
          const salt   = generateSalt(); // 16 bytes random
          const key    = deriveKey(secret.toString('hex'), salt);
          const payload = Buffer.concat([secret, salt]); // 32 bytes total

          const hdr = Buffer.allocUnsafe(4);
          hdr.writeUInt32LE(payload.length, 0);
          socket.write(Buffer.concat([hdr, payload]));

          this.emit('transfer-start', peer.id, peer.name);

          await sendFiles(socket, filePaths, key, onProgress, cancelRef);
          socket.end();
          this._active.delete(peer.id);
          resolve();
        } catch (err) {
          socket.destroy();
          this._active.delete(peer.id);
          reject(err);
        }
      });
    });
  }

  cancelTransfer(peerId) {
    const s = this._active.get(peerId);
    if (s) s.cancelRef.cancelled = true;
  }

  // ─── Receiver ──────────────────────────────────────────────────

  _handleIncoming(socket) {
    console.log(`[Connection] Incoming from ${socket.remoteAddress}`);

    const parser = new FrameParser();
    let phase = 'AWAIT_HELLO';
    let peerId, peerName;

    socket.on('data',  (d)   => parser.push(d));
    socket.on('error', (err) => console.error('[Connection] Socket error:', err.message));

    const timeout = setTimeout(() => {
      console.warn('[Connection] Handshake timeout');
      socket.destroy();
    }, HANDSHAKE_TIMEOUT);

    parser.on('frame', (frame) => {
      try {
        if (phase === 'AWAIT_HELLO') {
          const msg = _tryParseJSON(frame);
          if (!msg || msg.type !== 'HELLO') return;

          peerId   = msg.id;
          peerName = msg.name;
          phase    = 'AWAIT_DECISION';

          this.onIncomingRequest(
            peerId,
            peerName,
            socket.remoteAddress,
            msg.fileCount || 0,
            msg.totalSize || 0,
            msg.files     || [],
            // acceptFn
            () => {
              clearTimeout(timeout);
              socket.write(frameJSON({ type: 'HELLO_ACK', accepted: true }));
              phase = 'AWAIT_KEY';
            },
            // rejectFn
            () => {
              clearTimeout(timeout);
              socket.write(frameJSON({ type: 'HELLO_ACK', accepted: false }));
              setTimeout(() => socket.destroy(), 200);
            }
          );
          return;
        }

        if (phase === 'AWAIT_KEY') {
          // frame = [secret(16) | salt(16)] = 32 bytes
          if (frame.length < 32) return;
          const secret = frame.slice(0, 16);
          const salt   = frame.slice(16, 32);
          const key    = deriveKey(secret.toString('hex'), salt);

          phase = 'TRANSFERRING';
          this.emit('transfer-start', peerId, peerName);

          receiveFiles(
            socket,
            key,
            this.downloadDir,
            (idx, filename, received, total) => {
              this.emit('progress', peerId, idx, filename, received, total);
            },
            () => this.emit('transfer-complete', peerId),
            () => this.emit('transfer-cancelled', peerId)
          );
        }
      } catch (err) {
        console.error('[Connection] Frame error:', err.message);
        socket.destroy();
      }
    });
  }
}

function _tryParseJSON(buf) {
  try { return JSON.parse(buf.toString()); } catch (_) { return null; }
}

module.exports = ConnectionManager;
