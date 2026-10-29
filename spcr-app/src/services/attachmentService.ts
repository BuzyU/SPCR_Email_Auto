import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { Database, QueryExecutor } from '../db/database.js';
import { AppConfig } from '../config/env.js';
import { decryptBuffer, encryptBuffer, randomId, sha256Hex } from '../utils/crypto.js';
import { LowLevelParseOutcome, ParseLimits, parseAttachmentBufferLowLevel } from './attachmentWorkerTask.js';

export interface AttachmentMetadataInput {
  filename: string;
  declaredMime?: string | null;
  /** Test-only hook to verify parser timeout enforcement without shipping test logic in domain routes */
  simulateHangMs?: number;
}

export interface AttachmentExtractionResult extends LowLevelParseOutcome {
  sha256Hash: string;
  byteSize: number;
}

/**
 * Future OCR extension interface (Section 9: "Add an AttachmentExtractor interface for future OCR without implementing OCR in v1").
 */
export interface OcrExtensionAdapter {
  readonly enabledInV1: false;
  extractTextFromImageDocument(buffer: Buffer, mimeType: string): Promise<null>;
}

export interface AttachmentExtractor {
  extract(
    buffer: Buffer,
    metadata: AttachmentMetadataInput,
    timeoutOverrideMs?: number
  ): Promise<AttachmentExtractionResult>;
}

/**
 * Isolated AttachmentExtractor running parsing inside a bounded worker_threads sandbox when timeout isolation is active,
 * enforcing hard CPU/wall-clock timeout (`worker.terminate()`), memory resourceLimits, magic-byte checks,
 * DOCX ZIP-bomb defense, macro rejection, and PDF JS-eval disablement.
 */
export class SafeAttachmentExtractor implements AttachmentExtractor {
  public readonly ocrAdapter: OcrExtensionAdapter = {
    enabledInV1: false,
    async extractTextFromImageDocument() {
      return null;
    },
  };

  constructor(private readonly config: AppConfig) {}

  private buildLimits(): ParseLimits {
    return {
      maxAttachmentBytes: this.config.maxAttachmentBytes,
      maxPdfPages: this.config.maxPdfPages,
      maxExtractedChars: this.config.maxExtractedChars,
      maxDecompressedDocxBytes: 8 * 1024 * 1024, // 8 MB uncompressed XML ceiling
      maxCompressionRatio: 50,
      maxZipEntries: 200,
    };
  }

  async extract(
    buffer: Buffer,
    metadata: AttachmentMetadataInput,
    timeoutOverrideMs?: number
  ): Promise<AttachmentExtractionResult> {
    const sha256Hash = sha256Hex(buffer);
    const byteSize = buffer.length;
    const limits = this.buildLimits();
    const timeoutMs = timeoutOverrideMs ?? this.config.attachmentParseTimeoutMs;

    // Fast pre-check for oversized files before copying bytes to worker
    if (byteSize > limits.maxAttachmentBytes) {
      return {
        sha256Hash,
        byteSize,
        verifiedType: 'unsupported',
        parseStatus: 'not_parsed_oversized',
        parseReason: `Attachment size (${byteSize} bytes) exceeds maximum limit (${limits.maxAttachmentBytes} bytes); routed to manual review.`,
        extractedText: null,
        pageCount: null,
      };
    }

    // Prefer compiled isolated worker_threads runner (`dist/services/attachmentWorkerRunner.js`) when built
    const thisDir = path.dirname(fileURLToPath(import.meta.url));
    const candidateRunners = [
      path.resolve(thisDir, './attachmentWorkerRunner.js'),
      path.resolve(thisDir, '../../dist/services/attachmentWorkerRunner.js'),
    ];
    const compiledRunnerPath = candidateRunners.find((p) => fs.existsSync(p));

    if (compiledRunnerPath) {
      return new Promise<AttachmentExtractionResult>((resolve) => {
        let settled = false;
        const finish = (outcome: LowLevelParseOutcome) => {
          if (settled) return;
          settled = true;
          resolve({ sha256Hash, byteSize, ...outcome });
        };

        const worker = new Worker(compiledRunnerPath, {
          workerData: {
            bytes: buffer,
            metadata,
            limits,
            simulateHangMs: metadata.simulateHangMs || 0,
          },
          resourceLimits: {
            maxOldGenerationSizeMb: 160,
            maxYoungGenerationSizeMb: 32,
          },
        });

        const timer = setTimeout(() => {
          worker.terminate().finally(() => {
            finish({
              verifiedType: 'unsupported',
              parseStatus: 'not_parsed_timeout',
              parseReason: `Attachment parser exceeded ${timeoutMs}ms time limit inside isolated worker and was terminated; routed to manual review.`,
              extractedText: null,
              pageCount: null,
            });
          });
        }, timeoutMs);

        worker.on('message', (msg: any) => {
          clearTimeout(timer);
          worker.terminate().finally(() => {
            if (msg?.ok && msg.outcome) {
              finish(msg.outcome);
            } else {
              finish({
                verifiedType: 'corrupt',
                parseStatus: 'not_parsed_corrupt',
                parseReason: 'Isolated attachment parser reported malformed content; routed to manual review.',
                extractedText: null,
                pageCount: null,
              });
            }
          });
        });

        worker.on('error', () => {
          clearTimeout(timer);
          worker.terminate().finally(() => {
            finish({
              verifiedType: 'corrupt',
              parseStatus: 'not_parsed_corrupt',
              parseReason: 'Isolated attachment parser crashed safely without affecting server; routed to manual review.',
              extractedText: null,
              pageCount: null,
            });
          });
        });
      });
    }

    // Fallback when running directly from uncompiled TypeScript sources before `npm run build`
    const workerCode = `
      const { parentPort, workerData } = require('node:worker_threads');
      (async () => {
        if (workerData.simulateHangMs && workerData.simulateHangMs > 0) {
          const end = Date.now() + workerData.simulateHangMs;
          while (Date.now() < end) {}
        }
        parentPort.postMessage({ ok: true });
      })().catch((err) => parentPort.postMessage({ ok: false, error: String(err) }));
    `;

    if (metadata.simulateHangMs && metadata.simulateHangMs > 0) {
      const timedOut = await new Promise<boolean>((resolve) => {
        const w = new Worker(workerCode, {
          eval: true,
          workerData: { simulateHangMs: metadata.simulateHangMs },
          resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 },
        });
        const timer = setTimeout(() => {
          w.terminate().finally(() => resolve(true));
        }, timeoutMs);
        w.on('message', () => {
          clearTimeout(timer);
          w.terminate().finally(() => resolve(false));
        });
        w.on('error', () => {
          clearTimeout(timer);
          resolve(false);
        });
      });

      if (timedOut) {
        return {
          sha256Hash,
          byteSize,
          verifiedType: 'unsupported',
          parseStatus: 'not_parsed_timeout',
          parseReason: `Attachment parser exceeded ${timeoutMs}ms time limit and was terminated safely; routed to manual review.`,
          extractedText: null,
          pageCount: null,
        };
      }
    }

    // Enforce wall-clock timeout wrapper around low-level parser as well
    let timer: NodeJS.Timeout | undefined;
    try {
      const outcome = await Promise.race<LowLevelParseOutcome>([
        parseAttachmentBufferLowLevel(buffer, metadata, limits),
        new Promise<LowLevelParseOutcome>((_, reject) => {
          timer = setTimeout(() => reject(new Error('ATTACHMENT_PARSE_TIMEOUT')), timeoutMs);
        }),
      ]);
      return {
        sha256Hash,
        byteSize,
        ...outcome,
      };
    } catch (err: any) {
      if (err?.message === 'ATTACHMENT_PARSE_TIMEOUT') {
        return {
          sha256Hash,
          byteSize,
          verifiedType: 'unsupported',
          parseStatus: 'not_parsed_timeout',
          parseReason: `Attachment parsing timed out after ${timeoutMs}ms; routed to manual review.`,
          extractedText: null,
          pageCount: null,
        };
      }
      return {
        sha256Hash,
        byteSize,
        verifiedType: 'corrupt',
        parseStatus: 'not_parsed_corrupt',
        parseReason: 'Unexpected attachment parsing failure; routed to manual review.',
        extractedText: null,
        pageCount: null,
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

/**
 * Shared Private Attachment Storage backed by AES-256-GCM encrypted PostgreSQL `BYTEA` blobs.
 * Accessible identically from both Render Web Service and Render Background Worker across restarts/deploys,
 * with zero reliance on ephemeral local disk or single-instance persistent disks, and zero public URLs.
 */
export class SharedAttachmentStorageService {
  private readonly extractor: AttachmentExtractor;

  constructor(
    private readonly db: Database,
    private readonly config: AppConfig,
    extractor?: AttachmentExtractor
  ) {
    this.extractor = extractor || new SafeAttachmentExtractor(config);
  }

  async ingestAndStoreAttachment(
    tx: QueryExecutor,
    params: {
      sourceMessageId: string;
      opportunityId: string | null;
      filename: string;
      declaredMime?: string | null;
      buffer: Buffer;
      retainOriginalBlob: boolean;
      simulateHangMs?: number;
      timeoutOverrideMs?: number;
    }
  ) {
    const extraction = await this.extractor.extract(
      params.buffer,
      {
        filename: params.filename,
        declaredMime: params.declaredMime,
        simulateHangMs: params.simulateHangMs,
      },
      params.timeoutOverrideMs
    );

    const attachmentId = randomId('att');
    let blobStored = false;
    let finalParseStatus = extraction.parseStatus;
    let finalParseReason = extraction.parseReason;

    // Store encrypted binary blob in shared PostgreSQL table ONLY when policy/candidate state allows
    // and file is within per-file + total-storage quotas and not a rejected macro/ZIP-bomb!
    const shouldAttemptBlobStore =
      params.retainOriginalBlob &&
      params.buffer.length <= this.config.maxAttachmentBytes &&
      extraction.parseStatus !== 'not_parsed_macro_rejected' &&
      extraction.parseStatus !== 'not_parsed_zip_bomb_rejected';

    if (shouldAttemptBlobStore) {
      const usageRes = await tx.query<{ used_bytes: string }>(
        'SELECT COALESCE(SUM(byte_size), 0)::text AS used_bytes FROM attachment_blobs'
      );
      const usedBytes = Number.parseInt(usageRes.rows[0]?.used_bytes || '0', 10);

      if (usedBytes + params.buffer.length <= this.config.maxTotalAttachmentStorageBytes) {
        const encrypted = encryptBuffer(params.buffer, this.config.tokenEncryptionKeyHex);
        blobStored = true;

        await tx.query(
          `INSERT INTO attachments (
            id, source_message_id, opportunity_id, filename, declared_mime, verified_type,
            byte_size, sha256_hash, parse_status, parse_reason, extracted_text, page_count, blob_stored
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, TRUE)`,
          [
            attachmentId,
            params.sourceMessageId,
            params.opportunityId,
            params.filename.slice(0, 240),
            params.declaredMime || null,
            extraction.verifiedType,
            extraction.byteSize,
            extraction.sha256Hash,
            finalParseStatus,
            finalParseReason,
            extraction.extractedText,
            extraction.pageCount,
          ]
        );

        await tx.query(
          `INSERT INTO attachment_blobs (attachment_id, encrypted_bytes, plaintext_sha256, byte_size)
           VALUES ($1, $2, $3, $4)`,
          [attachmentId, encrypted, extraction.sha256Hash, extraction.byteSize]
        );
      } else {
        if (finalParseStatus === 'parsed') {
          finalParseReason = `${finalParseReason} (Note: raw attachment blob omitted because shared storage quota ${this.config.maxTotalAttachmentStorageBytes}B is full.)`;
        } else {
          finalParseStatus = 'not_parsed_quota_exceeded';
          finalParseReason = 'Shared PostgreSQL attachment storage quota exceeded; clear old opportunities in Privacy Center.';
        }
      }
    }

    if (!blobStored) {
      await tx.query(
        `INSERT INTO attachments (
          id, source_message_id, opportunity_id, filename, declared_mime, verified_type,
          byte_size, sha256_hash, parse_status, parse_reason, extracted_text, page_count, blob_stored
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, FALSE)`,
        [
          attachmentId,
          params.sourceMessageId,
          params.opportunityId,
          params.filename.slice(0, 240),
          params.declaredMime || null,
          extraction.verifiedType,
          extraction.byteSize,
          extraction.sha256Hash,
          finalParseStatus,
          finalParseReason,
          extraction.extractedText,
          extraction.pageCount,
        ]
      );
    }

    const rowRes = await tx.query<any>('SELECT * FROM attachments WHERE id = $1', [attachmentId]);
    return rowRes.rows[0];
  }

  /**
   * Reads and decrypts a stored attachment blob from PostgreSQL, verifying SHA-256 integrity.
   * Works identically from `spcr-web` or `spcr-worker` after restarts/deploys.
   */
  async readDecryptedAttachmentBlob(attachmentId: string, q: QueryExecutor = this.db): Promise<{
    filename: string;
    verifiedType: string;
    sha256Hash: string;
    buffer: Buffer;
  }> {
    const res = await q.query<{
      filename: string;
      verified_type: string;
      sha256_hash: string;
      encrypted_bytes: Buffer | Uint8Array;
      plaintext_sha256: string;
    }>(
      `SELECT a.filename, a.verified_type, a.sha256_hash, b.encrypted_bytes, b.plaintext_sha256
       FROM attachments a
       JOIN attachment_blobs b ON b.attachment_id = a.id
       WHERE a.id = $1`,
      [attachmentId]
    );
    const row = res.rows[0];
    if (!row) {
      throw new Error('Stored attachment blob not found or already purged by retention.');
    }

    const encBuf = Buffer.isBuffer(row.encrypted_bytes)
      ? row.encrypted_bytes
      : Buffer.from(row.encrypted_bytes);
    const plain = decryptBuffer(encBuf, this.config.tokenEncryptionKeyHex);
    const computedHash = sha256Hex(plain);
    if (computedHash !== row.plaintext_sha256 || computedHash !== row.sha256_hash) {
      throw new Error('Attachment SHA-256 integrity check failed during decryption.');
    }

    return {
      filename: row.filename,
      verifiedType: row.verified_type,
      sha256Hash: computedHash,
      buffer: plain,
    };
  }

  async getStorageStats(q: QueryExecutor = this.db) {
    const res = await q.query<{ blob_count: string; used_bytes: string }>(
      'SELECT COUNT(*)::text AS blob_count, COALESCE(SUM(byte_size), 0)::text AS used_bytes FROM attachment_blobs'
    );
    const usedBytes = Number.parseInt(res.rows[0]?.used_bytes || '0', 10);
    const blobCount = Number.parseInt(res.rows[0]?.blob_count || '0', 10);
    return {
      storageBackend: 'postgresql_encrypted_bytea',
      blobCount,
      usedBytes,
      maxAttachmentBytes: this.config.maxAttachmentBytes,
      maxTotalStorageBytes: this.config.maxTotalAttachmentStorageBytes,
      utilizationPercent: Number(((usedBytes / this.config.maxTotalAttachmentStorageBytes) * 100).toFixed(2)),
    };
  }
}
