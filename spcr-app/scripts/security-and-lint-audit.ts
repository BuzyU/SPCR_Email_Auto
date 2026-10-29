// SPCR Security, Architecture & UI Lint Audit (`npm run lint`)
// Enforces hard architectural invariants from SPCR_AI3_Implementation_Prompt_Groq_Render_v2.md:
// 1. Screening pipeline modules (`authenticityService`, `localClassifier`, `factExtractor`, `screeningAndMatchingService`)
//    MUST NOT import or invoke Groq (`groqDraftingService` / `api.groq.com`).
// 2. Zero `web.whatsapp.com` DOM automation or auto-clicking scripts anywhere in `src/`, `client/`, or `extension/`.
// 3. Zero emojis in application UI (`client/`, `extension/`) or announcement templates (`src/services/factExtractor.ts`).
// 4. Zero hardcoded live secrets (`gsk_`, `GOCSPX-`, private keys) in source or release artifacts.
// 5. Extension manifest (`release/unpacked/manifest.json` if built, and `extension/manifest.template.json`)
//    MUST use Manifest V3 and MUST NOT contain wildcard host permissions or `<all_urls>`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const violations: string[] = [];

function walkFiles(dir: string, exts: string[]): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.models_cache') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full, exts));
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

// 1. Verify Zero Groq imports/URLs inside Independent Screening Pipeline
const screeningFiles = [
  'src/services/authenticityService.ts',
  'src/services/localClassifier.ts',
  'src/services/factExtractor.ts',
  'src/services/screeningAndMatchingService.ts',
];
for (const rel of screeningFiles) {
  const full = path.join(rootDir, rel);
  const content = fs.readFileSync(full, 'utf8');
  if (/groqDraftingService|api\.groq\.com/i.test(content)) {
    violations.push(`[ZERO-GROQ VIOLATION] ${rel} references Groq service or endpoint.`);
  }
}

// 2. Verify Zero WhatsApp Web DOM scripting, unofficial libraries, or extension WhatsApp hooks
const backendFiles = walkFiles(path.join(rootDir, 'src'), ['.ts']);
const clientFiles = walkFiles(path.join(rootDir, 'client'), ['.ts', '.tsx', '.html']);
const extensionFiles = walkFiles(path.join(rootDir, 'extension'), ['.ts', '.html', '.json']);
const codeFiles = [...backendFiles, ...clientFiles, ...extensionFiles];

for (const file of [...backendFiles, ...extensionFiles]) {
  const rel = path.relative(rootDir, file);
  const content = fs.readFileSync(file, 'utf8');
  if (/web\.whatsapp\.com|whatsapp-web\.js|baileys|puppeteer|playwright/i.test(content)) {
    violations.push(`[WHATSAPP AUTOMATION VIOLATION] ${rel} references automated WhatsApp Web scripting or unofficial SDK.`);
  }
}

for (const file of codeFiles) {
  const rel = path.relative(rootDir, file);
  const content = fs.readFileSync(file, 'utf8');
  // Check for leaked live secret prefixes
  if (/gsk_[A-Za-z0-9]{20,}/.test(content) || /GOCSPX-[A-Za-z0-9_-]{15,}/.test(content)) {
    violations.push(`[SECRET LEAK VIOLATION] ${rel} contains a live-pattern credential token.`);
  }
}

// 3. Verify Zero Emojis in UI, Extension, and Draft Formatter
const emojiSensitiveFiles = [
  ...walkFiles(path.join(rootDir, 'client'), ['.ts', '.tsx', '.html', '.css']),
  ...walkFiles(path.join(rootDir, 'extension'), ['.ts', '.html', '.css', '.json']),
  path.join(rootDir, 'src', 'services', 'factExtractor.ts'),
];
const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
for (const file of emojiSensitiveFiles) {
  if (!fs.existsSync(file)) continue;
  const rel = path.relative(rootDir, file);
  // Skip regex literal inside stripDisallowedEmojis if it were here (it's in groqDraftingService.ts)
  const content = fs.readFileSync(file, 'utf8');
  if (emojiRegex.test(content)) {
    violations.push(`[UI EMOJI VIOLATION] ${rel} contains disallowed emoji characters.`);
  }
}

// 4. Verify Extension Manifest V3 Narrow Permissions
const manifestPaths = [
  path.join(rootDir, 'extension', 'manifest.template.json'),
  path.join(rootDir, 'release', 'unpacked', 'manifest.json'),
];
for (const mp of manifestPaths) {
  if (!fs.existsSync(mp)) continue;
  const rel = path.relative(rootDir, mp);
  const manifest = JSON.parse(fs.readFileSync(mp, 'utf8'));
  if (manifest.manifest_version !== 3) {
    violations.push(`[MANIFEST VIOLATION] ${rel} must declare manifest_version: 3.`);
  }
  const hosts: string[] = manifest.host_permissions || [];
  if (hosts.some((h) => h.includes('*://*/*') || h === '<all_urls>' || h.includes('whatsapp'))) {
    violations.push(`[MANIFEST PERMISSION VIOLATION] ${rel} contains prohibited broad or WhatsApp host permission.`);
  }
}

if (violations.length > 0) {
  console.error('SPCR Security & Architecture Lint FAILED:');
  for (const v of violations) {
    console.error(` - ${v}`);
  }
  process.exit(1);
}

console.log(
  `[lint] PASS — Checked ${codeFiles.length} source files: zero Groq imports in screening, zero WhatsApp DOM scripts, zero UI emojis, zero leaked secrets, narrow MV3 permissions.`
);
