/**
 * encryption.js
 * AES-256-CBC encryption/decryption for file chunks
 * Uses Node.js built-in crypto module — no external dependencies
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';
const KEY_LENGTH = 32;  // 256 bits
const IV_LENGTH  = 16;  // 128 bits (CBC block size)

/**
 * Derive a 256-bit key from a shared PIN/secret using PBKDF2.
 * Both sides must use the same pin + salt to get matching keys.
 *
 * @param {string} pin   - The 4-digit PIN agreed upon during pairing
 * @param {Buffer} salt  - Random 16-byte salt (sent in handshake)
 * @returns {Buffer} 32-byte key
 */
function deriveKey(pin, salt) {
  return crypto.pbkdf2Sync(pin, salt, 100_000, KEY_LENGTH, 'sha256');
}

/**
 * Generate a cryptographically random 16-byte salt.
 * Used once per session and shared with the receiver during handshake.
 *
 * @returns {Buffer}
 */
function generateSalt() {
  return crypto.randomBytes(16);
}

/**
 * Encrypt a Buffer chunk.
 * Prepends a fresh random IV to each chunk so every chunk is unique.
 *
 * Layout of returned Buffer:
 *   [16 bytes IV][N bytes ciphertext]
 *
 * @param {Buffer} data  - Raw chunk to encrypt
 * @param {Buffer} key   - 32-byte AES key (from deriveKey)
 * @returns {Buffer}
 */
function encryptChunk(data, key) {
  const iv     = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const enc    = Buffer.concat([cipher.update(data), cipher.final()]);
  // Prefix IV so the receiver can decrypt without extra state
  return Buffer.concat([iv, enc]);
}

/**
 * Decrypt a Buffer chunk produced by encryptChunk.
 *
 * @param {Buffer} data  - [IV || ciphertext] buffer
 * @param {Buffer} key   - 32-byte AES key (from deriveKey)
 * @returns {Buffer} Plaintext
 */
function decryptChunk(data, key) {
  const iv         = data.slice(0, IV_LENGTH);
  const ciphertext = data.slice(IV_LENGTH);
  const decipher   = crypto.createDecipheriv(ALGORITHM, key, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Generate a random 4-digit PIN string (e.g. "0472").
 *
 * @returns {string}
 */
function generatePIN() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

/**
 * Generate a random session ID for device identification.
 *
 * @returns {string} hex string
 */
function generateSessionId() {
  return crypto.randomBytes(8).toString('hex');
}

module.exports = {
  deriveKey,
  generateSalt,
  encryptChunk,
  decryptChunk,
  generatePIN,
  generateSessionId,
};
