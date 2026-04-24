/**
 * connection.js
 * TCP server + client for device pairing and file transfer sessions.
 *
 * Handshake sequence (after TCP connect):
 *
 *  Initiator (sender)                    Receiver
 *  ──────────────────                    ────────
 *  → HELLO { id, name }
 *                                        ← HELLO_ACK { accepted: true/false }
 *  (if accepted, receiver shows PIN)
 *  → PIN_ATTEMPT { pin }
 *                                        ← PIN_RESULT { ok: true/false }
 *  (if ok, both derive key from PIN+salt)
 *  → salt (binary, 16 bytes, framed)
 *  ─── file transfer begins ───
 *
 * All messages use the same length-prefix framing as fileTransfer.js
 */

const net  = require('net');
const path = require('path');
const os   = require('os');
const EventEmitter = require('events');
const { deriveKey, generateSalt, generatePIN } = require('./encryption');
const { frameJSON, FrameParser, sendFiles, receiveFiles } = require('./fileTransfer');

const HANDSHAKE_TIMEOUT = 30_000;  // 30 s to complete pairing

class ConnectionManager extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string}   opts.id         - This device's session id
   * @param {string}   opts.name       - This device's display name
   * @param {string}   opts.downloadDir - Where to save received files
   * @param {Function} opts.onIncomingRequest  - (peerId, peerName, acceptFn, rejectFn) => void
   * @param {Function} opts.onPinRequired      - (pin) => void  (show PIN to user)
   */
  constructor(opts) {
    super();
    this.id          = opts.id;
    this.name        = opts.name;
    this.downloadDir = opts.downloadDir || os.homedir();
    this.onIncomingRequest = opts.onIncomingRequest;
    this.onPinRequired     = opts.onPinRequired;

    this._server  = null;
    this._port    = null;
    this._pending = new Map();   // peerId → { socket, resolve, reject, pin, salt }
    this._active  = new Map();   // peerId → { socket, key, cancelRef }
  }

  // ─── Server ────────────────────────────────────────────────────────────────

  /** Start TCP server on a random available port. Returns port number. */
  startServer() {
    return new Promise((resolve, reject) => {
      this._server = net.createServer((socket) => {
        this._handleIncoming(socket);
      });

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
    if (this._server) {
      this._server.close();
      this._server = null;
    }
  }

  // ─── Outgoing connection (initiator / sender side) ─────────────────────────

  /**
   * Connect to a peer, go through the handshake, and send files.
   *
   * @param {object}   peer        - { address, tcpPort, id, name }
   * @param {string[]} filePaths   - Files to send
   * @param {string}   pin         - PIN entered by the user
   * @param {Function} onProgress  - (fileIdx, filename, sent, total) => void
   * @returns {Promise<void>}
   */
  sendToPeer(peer, filePaths, pin, onProgress) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: peer.address, port: peer.tcpPort }, () => {
        console.log(`[Connection] Connected to ${peer.name} @ ${peer.address}:${peer.tcpPort}`);
      });

      socket.on('error', (err) => {
        console.error('[Connection] Socket error:', err.message);
        reject(err);
      });

      const parser = new FrameParser();
      let   phase  = 'HELLO';

      socket.on('data', (data) => parser.push(data));

      const cancelRef = { cancelled: false };
      this._active.set(peer.id, { socket, cancelRef });

      parser.on('frame', async (frame) => {
        try {
          if (phase === 'HELLO') {
            // Send our greeting
            socket.write(frameJSON({ type: 'HELLO', id: this.id, name: this.name }));
            phase = 'AWAIT_ACK';
            return;
          }

          const msg = _tryParseJSON(frame);
          if (!msg) return;

          if (phase === 'AWAIT_ACK') {
            if (!msg.accepted) {
              socket.destroy();
              return reject(new Error('Connection rejected by receiver'));
            }
            // Send PIN attempt
            socket.write(frameJSON({ type: 'PIN_ATTEMPT', pin }));
            phase = 'AWAIT_PIN_RESULT';
            return;
          }

          if (phase === 'AWAIT_PIN_RESULT') {
            if (!msg.ok) {
              socket.destroy();
              return reject(new Error('Incorrect PIN'));
            }
            // Generate salt, derive key, send salt, then start transfer
            const salt = generateSalt();
            const key  = deriveKey(pin, salt);

            // Frame the salt as binary
            const saltHeader = Buffer.allocUnsafe(4);
            saltHeader.writeUInt32LE(salt.length, 0);
            socket.write(Buffer.concat([saltHeader, salt]));

            phase = 'TRANSFERRING';
            this.emit('transfer-start', peer.id);

            await sendFiles(socket, filePaths, key, onProgress, cancelRef);
            socket.end();
            this._active.delete(peer.id);
            resolve();
          }
        } catch (err) {
          socket.destroy();
          this._active.delete(peer.id);
          reject(err);
        }
      });

      // Kick off by triggering first frame emit (parser needs data first)
      // Actually: send HELLO immediately on connect
      socket.once('connect', () => {
        socket.write(frameJSON({ type: 'HELLO', id: this.id, name: this.name }));
        phase = 'AWAIT_ACK';
      });
    });
  }

  /**
   * Cancel an active outgoing transfer.
   * @param {string} peerId
   */
  cancelTransfer(peerId) {
    const session = this._active.get(peerId);
    if (session) {
      session.cancelRef.cancelled = true;
    }
  }

  // ─── Incoming connection (receiver side) ──────────────────────────────────

  _handleIncoming(socket) {
    console.log(`[Connection] Incoming TCP from ${socket.remoteAddress}`);
    const parser = new FrameParser();
    let   phase  = 'AWAIT_HELLO';
    let   peerId, peerName, sessionPin, sessionSalt;

    socket.on('data', (data) => parser.push(data));
    socket.on('error', (err) => console.error('[Connection] Incoming socket error:', err.message));
    socket.on('close', () => {
      if (peerId) this._pending.delete(peerId);
    });

    // Timeout if handshake not completed
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

          // Ask the UI if we should accept this connection
          this.onIncomingRequest(
            peerId,
            peerName,
            socket.remoteAddress,
            // acceptFn
            () => {
              sessionPin = generatePIN();
              this.onPinRequired(peerId, peerName, sessionPin);
              socket.write(frameJSON({ type: 'HELLO_ACK', accepted: true }));
              phase = 'AWAIT_PIN';
            },
            // rejectFn
            () => {
              socket.write(frameJSON({ type: 'HELLO_ACK', accepted: false }));
              setTimeout(() => socket.destroy(), 200);
            }
          );
          return;
        }

        if (phase === 'AWAIT_PIN') {
          const msg = _tryParseJSON(frame);
          if (!msg || msg.type !== 'PIN_ATTEMPT') return;

          if (msg.pin === sessionPin) {
            socket.write(frameJSON({ type: 'PIN_RESULT', ok: true }));
            phase = 'AWAIT_SALT';
          } else {
            socket.write(frameJSON({ type: 'PIN_RESULT', ok: false }));
            setTimeout(() => socket.destroy(), 200);
          }
          return;
        }

        if (phase === 'AWAIT_SALT') {
          // frame is raw 16-byte salt
          sessionSalt = frame;
          const key   = deriveKey(sessionPin, sessionSalt);
          clearTimeout(timeout);
          phase = 'TRANSFERRING';

          this.emit('transfer-start', peerId, peerName);

          receiveFiles(
            socket,
            key,
            this.downloadDir,
            (fileIdx, filename, received, total) => {
              this.emit('progress', peerId, fileIdx, filename, received, total);
            },
            () => {
              this.emit('transfer-complete', peerId);
            },
            () => {
              this.emit('transfer-cancelled', peerId);
            }
          );
        }
      } catch (err) {
        console.error('[Connection] Frame handling error:', err.message);
        socket.destroy();
      }
    });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _tryParseJSON(buf) {
  try { return JSON.parse(buf.toString()); } catch (_) { return null; }
}

module.exports = ConnectionManager;
