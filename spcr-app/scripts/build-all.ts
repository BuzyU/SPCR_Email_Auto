import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import { buildClient } from './build-client.js';
import { buildExtension } from './build-extension.js';

async function buildAll(): Promise<void> {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  // 1. Compile backend web server, background worker, and isolated attachment worker thread
  await esbuild.build({
    entryPoints: [
      path.join(rootDir, 'src', 'server.ts'),
      path.join(rootDir, 'src', 'worker.ts'),
      path.join(rootDir, 'src', 'services', 'attachmentWorkerRunner.ts'),
    ],
    outdir: path.join(rootDir, 'dist'),
    outbase: path.join(rootDir, 'src'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: ['node22'],
    packages: 'external',
    sourcemap: false,
  });
  console.log('[build:server] Compiled dist/server.js, dist/worker.js, and dist/services/attachmentWorkerRunner.js');

  // 2. Build frontend dashboard bundle (`dist/public/*`)
  await buildClient();

  // 3. Build Manifest V3 Chrome/Edge extension (`release/unpacked/*` + versioned `.zip` + `.sha256`)
  await buildExtension();
}

buildAll().catch((err) => {
  console.error('[build] Build failed:', err);
  process.exit(1);
});

