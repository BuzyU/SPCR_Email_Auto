import crypto from 'node:crypto';

const KEY_VERSION = 'v1';

function deriveKeyBuffer(hexOrPassphrase: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(hexOrPassphrase)) {
    return Buffer.from(hexOrPassphrase, 'hex');
  }
  return crypto.createHash('sha256').update(hexOrPassphrase, 'utf8').digest();
}

export function sha256Hex(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function hmacSha256Hex(secret: string, input: string): string {
  return crypto.createHmac('sha256', secret).update(input).digest('hex');
}

export function randomId(prefix?: string): string {
  const uuid = crypto.randomUUID();
  return prefix ? `${prefix}_${uuid}` : uuid;
}

export function randomTokenHex(byteLength = 32): string {
  return crypto.randomBytes(byteLength).toString('hex');
}

export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Authenticated AES-256-GCM string encryption (`v1:<ivHex>:<authTagHex>:<ciphertextHex>`).
 */
export function encryptSecretString(plaintext: string, keyHex: string): string {
  const key = deriveKeyBuffer(keyHex);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${KEY_VERSION}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecretString(payload: string, keyHex: string): string {
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== KEY_VERSION) {
    throw new Error('Unsupported or malformed encrypted payload version.');
  }
  const [, ivHex, tagHex, cipherHex] = parts;
  if (!ivHex || !tagHex || cipherHex === undefined) {
    throw new Error('Malformed encrypted payload components.');
  }
  const key = deriveKeyBuffer(keyHex);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(cipherHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Authenticated AES-256-GCM binary buffer encryption for shared PostgreSQL BYTEA attachment blobs.
 * Format: [1 byte version=1][12 bytes IV][16 bytes GCM AuthTag][ciphertext...]
 */
export function encryptBuffer(plainBuffer: Buffer, keyHex: string): Buffer {
  const key = deriveKeyBuffer(keyHex);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([1]), iv, authTag, ciphertext]);
}

export function decryptBuffer(encryptedBuffer: Buffer, keyHex: string): Buffer {
  if (encryptedBuffer.length < 1 + 12 + 16 || encryptedBuffer[0] !== 1) {
    throw new Error('Unsupported or corrupted encrypted blob header.');
  }
  const key = deriveKeyBuffer(keyHex);
  const iv = encryptedBuffer.subarray(1, 13);
  const authTag = encryptedBuffer.subarray(13, 29);
  const ciphertext = encryptedBuffer.subarray(29);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

