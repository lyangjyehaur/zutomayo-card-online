/* global module, require */

const crypto = require('crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function encryptionKey(secret, keyName = 'ADMIN_TOTP_ENCRYPTION_KEY') {
  const value = String(secret || '');
  if (value.length < 32) throw new Error(`${keyName} must be at least 32 characters`);
  return crypto.createHash('sha256').update(value).digest();
}

function encryptSecretEnvelope(secret, keySecret, keyName = 'SERVICE_CONFIG_ENCRYPTION_KEY') {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(keySecret, keyName), iv);
  const ciphertext = Buffer.concat([cipher.update(String(secret), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

function decryptSecretEnvelope(envelope, keySecret, keyName = 'SERVICE_CONFIG_ENCRYPTION_KEY') {
  const [version, ivPart, tagPart, ciphertextPart] = String(envelope || '').split('.');
  if (version !== 'v1' || !ivPart || !tagPart || !ciphertextPart) throw new Error('Invalid encrypted secret envelope');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(keySecret, keyName),
    Buffer.from(ivPart, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextPart, 'base64url')), decipher.final()]).toString('utf8');
}

function encryptAdminTotpSecret(secret, keySecret) {
  return encryptSecretEnvelope(secret, keySecret, 'ADMIN_TOTP_ENCRYPTION_KEY');
}

function decryptAdminTotpSecret(envelope, keySecret) {
  try {
    return decryptSecretEnvelope(envelope, keySecret, 'ADMIN_TOTP_ENCRYPTION_KEY');
  } catch (error) {
    if (error instanceof Error && error.message === 'Invalid encrypted secret envelope') {
      throw new Error('Invalid admin TOTP envelope');
    }
    throw error;
  }
}

function randomBase32(byteLength = 20) {
  const bytes = crypto.randomBytes(byteLength);
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  let output = '';
  for (let offset = 0; offset < bits.length; offset += 5) {
    output += BASE32_ALPHABET[Number.parseInt(bits.slice(offset, offset + 5).padEnd(5, '0'), 2)];
  }
  return output;
}

module.exports = {
  decryptSecretEnvelope,
  decryptAdminTotpSecret,
  encryptSecretEnvelope,
  encryptAdminTotpSecret,
  randomBase32,
};
