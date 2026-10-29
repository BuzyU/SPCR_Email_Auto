import fs from 'node:fs';
import path from 'node:path';
import { env, pipeline } from '@huggingface/transformers';
import { sha256Hex } from '../src/utils/crypto.js';

export const PINNED_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
export const PINNED_MODEL_REVISION = 'main';
export const PINNED_MODEL_LICENSE = 'Apache-2.0';

async function main() {
  const cacheDir = path.resolve(process.env.CLASSIFIER_CACHE_DIR || './.models_cache');
  fs.mkdirSync(cacheDir, { recursive: true });

  env.cacheDir = cacheDir;
  env.allowLocalModels = true;
  env.allowRemoteModels = true;

  console.log(`Downloading/verifying local CPU ONNX model ${PINNED_MODEL_ID} into ${cacheDir}...`);
  const t0 = Date.now();
  const extractor = await pipeline('feature-extraction', PINNED_MODEL_ID, {
    dtype: 'q8',
    revision: PINNED_MODEL_REVISION,
  });

  const sample = await extractor(
    'Campus Recruitment Drive 2027: Software Engineer Full-Time Opportunity for B.Tech CSE/ECE students.',
    { pooling: 'mean', normalize: true }
  );
  const elapsedMs = Date.now() - t0;

  // Walk cacheDir and compute SHA-256 hashes of cached artifacts
  const artifacts: Record<string, string> = {};
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        const rel = path.relative(cacheDir, full).replace(/\\/g, '/');
        artifacts[rel] = sha256Hex(fs.readFileSync(full));
      }
    }
  }
  walk(cacheDir);

  const manifestPath = path.join(cacheDir, 'spcr-model-manifest.json');
  const manifest = {
    modelId: PINNED_MODEL_ID,
    license: PINNED_MODEL_LICENSE,
    dtype: 'q8',
    embeddingDim: sample.dims[sample.dims.length - 1],
    verifiedAt: new Date().toISOString(),
    artifacts,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`ONNX model verified in ${elapsedMs}ms. Embedding dim: ${manifest.embeddingDim}`);
  console.log('Artifact SHA-256 checksums:', JSON.stringify(artifacts, null, 2));
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('preload-classifier-model.ts')) {
  main().catch((err) => {
    console.error('Model preload failed:', err);
    process.exit(1);
  });
}

