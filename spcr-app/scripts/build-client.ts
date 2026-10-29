import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

export async function buildClient(): Promise<void> {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const outDir = path.join(rootDir, 'dist', 'public');
  fs.mkdirSync(outDir, { recursive: true });

  await esbuild.build({
    entryPoints: [path.join(rootDir, 'client', 'main.tsx')],
    outfile: path.join(outDir, 'bundle.js'),
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: ['es2022'],
    minify: true,
    sourcemap: false,
    define: {
      'process.env.NODE_ENV': '"production"',
    },
  });

  fs.copyFileSync(path.join(rootDir, 'client', 'index.html'), path.join(outDir, 'index.html'));
  fs.copyFileSync(path.join(rootDir, 'client', 'styles.css'), path.join(outDir, 'styles.css'));
  console.log(`[build:client] Built frontend bundle to ${outDir}`);
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('build-client.ts')) {
  buildClient().catch((err) => {
    console.error('[build:client] Failed:', err);
    process.exit(1);
  });
}

