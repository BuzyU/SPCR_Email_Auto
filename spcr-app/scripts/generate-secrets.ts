import crypto from 'node:crypto';

/**
 * Generates fresh cryptographically secure application secrets for Render Environment Settings.
 * Prints instructions without writing secrets to tracked files.
 */
function main() {
  const sessionSecret = crypto.randomBytes(32).toString('hex');
  const tokenEncryptionKey = crypto.randomBytes(32).toString('hex');
  const workerSharedSecret = crypto.randomBytes(32).toString('hex');

  console.log('# Copy these generated values directly into Render Dashboard -> Environment.');
  console.log('# NEVER commit them to Git or paste them into chat logs.');
  console.log(`SESSION_SECRET=${sessionSecret}`);
  console.log(`TOKEN_ENCRYPTION_KEY=${tokenEncryptionKey}`);
  console.log(`WORKER_SHARED_SECRET=${workerSharedSecret}`);
}

main();

