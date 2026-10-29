import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';
import { zipSync } from 'fflate';

/**
 * Generates a valid binary RGBA PNG icon (clean slate-blue `#1F4E79` badge with crisp white geometric inner bars)
 * without external native image build dependencies.
 */
function generateMinimalistPngIcon(size: number): Buffer {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c >>> 0;
  }

  function crc32(buf: Buffer): number {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c = crcTable[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function pngChunk(type: string, data: Buffer): Buffer {
    const typeBuf = Buffer.from(type, 'ascii');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcInput = Buffer.concat([typeBuf, data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(crcInput), 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
  }

  const rawScanlines = Buffer.alloc(size * (1 + size * 4));
  const pad = Math.max(1, Math.round(size * 0.12));
  const barLeft = Math.round(size * 0.25);
  const barRight = Math.round(size * 0.75);

  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    rawScanlines[rowStart] = 0; // Filter type 0 (None)
    for (let x = 0; x < size; x++) {
      const px = rowStart + 1 + x * 4;
      const insideBadge = x >= pad && x < size - pad && y >= pad && y < size - pad;
      const inBar1 = y >= Math.round(size * 0.30) && y < Math.round(size * 0.40) && x >= barLeft && x < barRight;
      const inBar2 = y >= Math.round(size * 0.47) && y < Math.round(size * 0.57) && x >= barLeft && x < barRight;
      const inBar3 =
        y >= Math.round(size * 0.64) &&
        y < Math.round(size * 0.74) &&
        x >= barLeft &&
        x < Math.round(size * 0.58);

      if (!insideBadge) {
        // Transparent outer margin
        rawScanlines[px] = 0;
        rawScanlines[px + 1] = 0;
        rawScanlines[px + 2] = 0;
        rawScanlines[px + 3] = 0;
      } else if (inBar1 || inBar2 || inBar3) {
        // Crisp white document lines (#FFFFFF)
        rawScanlines[px] = 255;
        rawScanlines[px + 1] = 255;
        rawScanlines[px + 2] = 255;
        rawScanlines[px + 3] = 255;
      } else {
        // Slate navy (#1F4E79 -> RGB 31, 78, 121)
        rawScanlines[px] = 31;
        rawScanlines[px + 1] = 78;
        rawScanlines[px + 2] = 121;
        rawScanlines[px + 3] = 255;
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressedIdat = zlib.deflateSync(rawScanlines, { level: 9 });
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressedIdat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function validateExtensionBackendOrigin(rawOrigin: string): string {
  const parsed = new URL(rawOrigin.trim());
  const isHttps = parsed.protocol === 'https:';
  const isLocalDev =
    parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
  if (!isHttps && !isLocalDev) {
    throw new Error(`EXTENSION_BACKEND_ORIGIN must be HTTPS (or localhost for local dev). Got: ${rawOrigin}`);
  }
  return parsed.origin;
}

export async function buildExtension(): Promise<{
  unpackedDir: string;
  zipPath: string;
  checksumPath: string;
  sha256: string;
}> {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const extSrcDir = path.join(rootDir, 'extension');
  const releaseDir = path.join(rootDir, 'release');
  const unpackedDir = path.join(releaseDir, 'unpacked');
  const iconsDir = path.join(unpackedDir, 'icons');
  const storeMetaDir = path.join(releaseDir, 'store-submission-readiness');

  const backendOrigin = validateExtensionBackendOrigin(
    process.env.EXTENSION_BACKEND_ORIGIN || 'https://spcr-web.onrender.com'
  );

  fs.rmSync(unpackedDir, { recursive: true, force: true });
  fs.mkdirSync(iconsDir, { recursive: true });
  fs.mkdirSync(storeMetaDir, { recursive: true });

  // 1. Render Manifest V3 with exact host_permissions
  const manifestTemplate = fs.readFileSync(path.join(extSrcDir, 'manifest.template.json'), 'utf8');
  const renderedManifest = manifestTemplate.replace(/__EXTENSION_BACKEND_ORIGIN__/g, backendOrigin);
  const parsedManifest = JSON.parse(renderedManifest);

  if (
    parsedManifest.host_permissions?.some((h: string) => h.includes('*://*/*') || h === '<all_urls>')
  ) {
    throw new Error('SECURITY VIOLATION: Wildcard host_permissions detected in extension manifest.');
  }

  const version = String(parsedManifest.version || '1.0.0');
  fs.writeFileSync(path.join(unpackedDir, 'manifest.json'), JSON.stringify(parsedManifest, null, 2) + '\n', 'utf8');

  // 2. Bundle Background Service Worker, Content Script, and Popup Script
  await esbuild.build({
    entryPoints: [path.join(extSrcDir, 'background.ts')],
    outfile: path.join(unpackedDir, 'background.js'),
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: ['es2022'],
    minify: false,
    define: {
      __DEFAULT_BACKEND_ORIGIN__: JSON.stringify(backendOrigin),
    },
  });

  await esbuild.build({
    entryPoints: [path.join(extSrcDir, 'content-gmail.ts')],
    outfile: path.join(unpackedDir, 'content-gmail.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: ['es2022'],
    minify: false,
  });

  await esbuild.build({
    entryPoints: [path.join(extSrcDir, 'popup.ts')],
    outfile: path.join(unpackedDir, 'popup.js'),
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: ['es2022'],
    minify: false,
  });

  fs.copyFileSync(path.join(extSrcDir, 'popup.html'), path.join(unpackedDir, 'popup.html'));
  fs.copyFileSync(path.join(extSrcDir, 'popup.css'), path.join(unpackedDir, 'popup.css'));

  // 3. Generate valid PNG icons (16, 48, 128)
  for (const size of [16, 48, 128]) {
    fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), generateMinimalistPngIcon(size));
  }

  // 4. Create versioned ZIP archive with `manifest.json` at archive root
  const zipEntries: Record<string, Uint8Array> = {};
  function collectFiles(dir: string, relPrefix = ''): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absPath = path.join(dir, entry.name);
      const zipRel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        collectFiles(absPath, zipRel);
      } else {
        zipEntries[zipRel] = new Uint8Array(fs.readFileSync(absPath));
      }
    }
  }
  collectFiles(unpackedDir);

  const zipBytes = Buffer.from(zipSync(zipEntries, { level: 9 }));
  const zipFilename = `SPCR-Chrome-Edge-Extension-v${version}.zip`;
  const zipPath = path.join(releaseDir, zipFilename);
  fs.writeFileSync(zipPath, zipBytes);

  const sha256 = crypto.createHash('sha256').update(zipBytes).digest('hex');
  const checksumPath = `${zipPath}.sha256`;
  fs.writeFileSync(checksumPath, `${sha256}  ${zipFilename}\n`, 'utf8');

  // 5. Generate Store Submission Readiness Metadata (marked clearly as NOT published live)
  const storeDoc = `# SPCR Chrome Web Store & Microsoft Edge Add-ons Submission Readiness

> **Publication Status:** **NOT PUBLISHED LIVE.** This folder contains submission-ready store listing metadata, permission justifications, and privacy disclosures. Publishing for one-click install requires the owner's developer account registration and store review.

## 1. Basic Listing Metadata

- **Extension Name:** SPCR — Placement Email Triage Companion
- **Short Name:** SPCR
- **Version:** ${version}
- **Category:** Productivity / Education (Institutional Single-Owner Companion)
- **Visibility Recommendation:** **Unlisted** (recommended for single-owner institutional TPO use so only the officer with the direct link or unpacked archive installs it).

## 2. Single-Purpose Statement

SPCR Companion enables an authenticated institutional Training & Placement Officer to trigger zero-LLM placement-email screening, optional post-screen announcement formatting, and review navigation between Gmail Web (\`https://mail.google.com\`) and their self-hosted SPCR backend (\`${backendOrigin}\`).

## 3. Narrow Permission Justifications

| Permission | Justification for Store Reviewers |
|---|---|
| \`storage\` | Stores only the single-owner pairing bearer token, CSRF token, and SPCR backend origin in \`chrome.storage.local\`. Zero API keys or third-party credentials are stored. |
| \`activeTab\` | Allows the toolbar popup fallback to check whether the officer's currently focused tab is \`https://mail.google.com/*\` and prefill the opened Gmail message ID on explicit click. |
| \`https://mail.google.com/*\` | Renders the minimalist SPCR action bar (\`Scan Email\`, \`Format Announcement with Groq\`, \`Review/Edit in SPCR\`, \`Choose WhatsApp Groups\`) inside the officer's opened Gmail thread and reads the active \`data-legacy-message-id\`. Does NOT perform background Gmail polling. |
| \`${backendOrigin}/*\` | Communicates exclusively with the officer's own hosted SPCR server over HTTPS using the paired token. Wildcard \`*://*/*\` permissions are strictly prohibited and absent. |

## 4. Data-Use & Privacy Disclosure

- **Does the extension collect analytics or telemetry?** No.
- **Does the extension inject ads or remote code?** No. All JavaScript is bundled statically inside the Manifest V3 package.
- **Does the extension automate WhatsApp Web?** No. Zero \`web.whatsapp.com\` permissions or scripts exist.
- **Data transmitted on \`Scan Email\`:** Sends only the opened \`gmailMessageId\` to the officer's SPCR server, where SPCR screens the message locally using deterministic checks + \`Xenova/all-MiniLM-L6-v2\` with **zero Groq requests**.

## 5. Developer Account Fees & Review Timelines

- **Chrome Web Store:** Requires a Google Chrome Web Store Developer account (**\\$5.00 USD one-time registration fee** at \`https://chrome.google.com/webstore/devconsole\`) and Google store review before one-click install works.
- **Microsoft Edge Add-ons:** Requires a Microsoft Partner Center Developer account (**\\$0 USD registration fee for individual/company Edge Add-ons** at \`https://partner.microsoft.com/dashboard/microsoftedge\`) and Microsoft store review.
- **Zero-Cost Immediate Option:** Extract \`${zipFilename}\` locally and load \`release/unpacked/\` via \`chrome://extensions\` or \`edge://extensions\` (\`Developer mode\` -> \`Load unpacked\`) per \`INSTALL_EXTENSION.md\`.

## 6. Screenshot Capture Checklist Before Store Upload

1. \`1280x800\` screenshot of Gmail thread showing the minimalist white SPCR bar (\`Scanned — no Groq request made\`).
2. \`1280x800\` screenshot of the SPCR Extension Toolbar Popup paired state.
3. \`1280x800\` screenshot of the SPCR Opportunity Review Workspace showing side-by-side source provenance and approval gate.
`;
  fs.writeFileSync(path.join(storeMetaDir, 'STORE_LISTING_AND_PRIVACY.md'), storeDoc, 'utf8');

  console.log(`[build:extension] Built unpacked extension -> ${unpackedDir}`);
  console.log(`[build:extension] Packaged ZIP -> ${zipPath}`);
  console.log(`[build:extension] SHA-256 -> ${sha256}`);

  return { unpackedDir, zipPath, checksumPath, sha256 };
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('build-extension.ts')) {
  buildExtension().catch((err) => {
    console.error('[build:extension] Failed:', err);
    process.exit(1);
  });
}

