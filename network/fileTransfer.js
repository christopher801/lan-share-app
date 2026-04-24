/**
 * fileTransfer.js
 * Multi-file transfer over an established TCP socket.
 *
 * Wire protocol (framing):
 *   Every message is length-prefixed:
 *     [4 bytes LE uint32 = payloadLength][payloadLength bytes JSON or binary]
 *
 *   Message types (JSON envelope):
 *     { type: 'FILE_START',  filename, size, index, total }
 *     { type: 'FILE_CHUNK',  data: <base64 encrypted chunk> }
 *     { type: 'FILE_END' }
 *     { type: 'TRANSFER_DONE' }
 *     { type: 'CANCEL' }
 *
 * Encryption:
 *   Each chunk is encrypted with AES-256-CBC using the session key
 *   derived from the PIN during the handshake phase.
 */

const fs   = require('fs');
const path = require('path');
const EventEmitter = require('events');
const { encryptChunk, decryptChunk } = require('./encryption');

const CHUNK_SIZE = 64 * 1024;  // 64 KB chunks

// ─── Framing helpers ────────────────────────────────────────────────────────

/**
 * Frame a JSON object into a length-prefixed buffer.
 * @param {object} obj
 * @returns {Buffer}
 */
function frameJSON(obj) {
  const payload = Buffer.from(JSON.stringify(obj));
  const header  = Buffer.allocUnsafe(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

/**
 * Frame raw binary data into a length-prefixed buffer.
 * @param {Buffer} data
 * @returns {Buffer}
 */
function frameBinary(data) {
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(data.length, 0);
  return Buffer.concat([header, data]);
}

// ─── FrameParser ────────────────────────────────────────────────────────────

/**
 * Stateful parser that assembles TCP stream data into discrete frames.
 * Emits 'frame' events with each complete frame Buffer.
 */
class FrameParser extends EventEmitter {
  constructor() {
    super();
    this._buf    = Buffer.alloc(0);
    this._needed = null; // bytes needed for current frame payload
  }

  push(data) {
    this._buf = Buffer.concat([this._buf, data]);
    this._parse();
  }

  _parse() {
    while (true) {
      if (this._needed === null) {
        if (this._buf.length < 4) break;
        this._needed = this._buf.readUInt32LE(0);
        this._buf    = this._buf.slice(4);
      }
      if (this._buf.length < this._needed) break;
      const frame  = this._buf.slice(0, this._needed);
      this._buf    = this._buf.slice(this._needed);
      this._needed = null;
      this.emit('frame', frame);
    }
  }
}

// ─── Sender ─────────────────────────────────────────────────────────────────

/**
 * Send one or more files over a connected socket.
 *
 * @param {net.Socket}  socket     - Established, writable TCP socket
 * @param {string[]}    filePaths  - Absolute paths to files to send
 * @param {Buffer}      key        - AES-256 session key
 * @param {Function}    onProgress - (fileIndex, filename, bytesSent, totalBytes) => void
 * @param {object}      cancelRef  - { cancelled: false } — set .cancelled = true to abort
 * @returns {Promise<void>}
 */
async function sendFiles(socket, filePaths, key, onProgress, cancelRef) {
  const total = filePaths.length;

  for (let i = 0; i < total; i++) {
    if (cancelRef && cancelRef.cancelled) {
      socket.write(frameJSON({ type: 'CANCEL' }));
      return;
    }

    const filePath = filePaths[i];
    const filename = path.basename(filePath);
    const stat     = fs.statSync(filePath);
    const fileSize = stat.size;

    console.log(`[FileTransfer] Sending [${i + 1}/${total}] ${filename} (${fileSize} bytes)`);

    // Announce file
    socket.write(frameJSON({ type: 'FILE_START', filename, size: fileSize, index: i, total }));

    // Stream + encrypt chunks
    let bytesSent = 0;
    await new Promise((resolve, reject) => {
      const stream = fs.createReadStream(filePath, { highWaterMark: CHUNK_SIZE });

      stream.on('data', (chunk) => {
        if (cancelRef && cancelRef.cancelled) {
          stream.destroy();
          socket.write(frameJSON({ type: 'CANCEL' }));
          return resolve();
        }
        const encrypted = encryptChunk(chunk, key);
        socket.write(frameBinary(encrypted));
        bytesSent += chunk.length;
        if (onProgress) onProgress(i, filename, bytesSent, fileSize);
      });

      stream.on('end', resolve);
      stream.on('error', reject);
    });

    // Signal end of this file
    socket.write(frameJSON({ type: 'FILE_END' }));
  }

  // All files done
  socket.write(frameJSON({ type: 'TRANSFER_DONE' }));
  console.log('[FileTransfer] All files sent.');
}

// ─── Receiver ───────────────────────────────────────────────────────────────

/**
 * Receive files from the socket and write them to destDir.
 *
 * @param {net.Socket}  socket     - Established TCP socket (receiving side)
 * @param {Buffer}      key        - AES-256 session key
 * @param {string}      destDir    - Directory to save received files
 * @param {Function}    onProgress - (fileIndex, filename, bytesReceived, totalBytes) => void
 * @param {Function}    onDone     - () => void — called when all files are received
 * @param {Function}    onCancel   - () => void — called if sender cancels
 * @returns {FrameParser} — attach socket.on('data', parser.push.bind(parser))
 */
function receiveFiles(socket, key, destDir, onProgress, onDone, onCancel) {
  const parser = new FrameParser();

  let currentFile   = null;  // { filename, size, index, total, bytesReceived, writeStream }
  let isChunkMode   = false; // true while we're inside a FILE_START…FILE_END block

  parser.on('frame', (frame) => {
    if (!isChunkMode) {
      // JSON control message
      let msg;
      try { msg = JSON.parse(frame.toString()); } catch (_) { return; }

      switch (msg.type) {
        case 'FILE_START':
          isChunkMode = true;
          const safeName = path.basename(msg.filename);
          const outPath  = _uniquePath(destDir, safeName);
          currentFile = {
            filename:      safeName,
            size:          msg.size,
            index:         msg.index,
            total:         msg.total,
            bytesReceived: 0,
            writeStream:   fs.createWriteStream(outPath),
            outPath,
          };
          console.log(`[FileTransfer] Receiving [${msg.index + 1}/${msg.total}] ${safeName} (${msg.size} bytes)`);
          break;

        case 'FILE_END':
          if (currentFile) {
            currentFile.writeStream.end();
            console.log(`[FileTransfer] File complete: ${currentFile.filename}`);
            currentFile = null;
          }
          isChunkMode = false;
          break;

        case 'TRANSFER_DONE':
          console.log('[FileTransfer] All files received.');
          if (onDone) onDone();
          break;

        case 'CANCEL':
          console.warn('[FileTransfer] Transfer cancelled by sender.');
          if (currentFile) currentFile.writeStream.destroy();
          if (onCancel) onCancel();
          break;
      }
    } else {
      // Binary encrypted chunk
      if (!currentFile) return;
      try {
        const decrypted = decryptChunk(frame, key);
        currentFile.writeStream.write(decrypted);
        currentFile.bytesReceived += decrypted.length;
        if (onProgress) {
          onProgress(
            currentFile.index,
            currentFile.filename,
            currentFile.bytesReceived,
            currentFile.size
          );
        }
      } catch (err) {
        console.error('[FileTransfer] Decrypt error:', err.message);
        currentFile.writeStream.destroy();
        currentFile = null;
        isChunkMode = false;
      }
    }
  });

  // Route socket data through parser
  socket.on('data', (data) => parser.push(data));

  return parser;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Ensure unique filename in destination directory.
 * e.g. "report.pdf" → "report (1).pdf" if already exists.
 */
function _uniquePath(dir, filename) {
  let candidate = path.join(dir, filename);
  if (!fs.existsSync(candidate)) return candidate;

  const ext  = path.extname(filename);
  const base = path.basename(filename, ext);
  let   n    = 1;
  do {
    candidate = path.join(dir, `${base} (${n})${ext}`);
    n++;
  } while (fs.existsSync(candidate));
  return candidate;
}

module.exports = { sendFiles, receiveFiles, FrameParser, frameJSON };
