import zlib from 'node:zlib';

export interface ParseLimits {
  maxAttachmentBytes: number;
  maxPdfPages: number;
  maxExtractedChars: number;
  maxDecompressedDocxBytes: number;
  maxCompressionRatio: number;
  maxZipEntries: number;
}

export interface LowLevelParseOutcome {
  verifiedType: 'pdf' | 'docx' | 'macro_rejected' | 'unsupported' | 'corrupt';
  parseStatus:
    | 'parsed'
    | 'not_parsed_encrypted'
    | 'not_parsed_scanned_or_image_only'
    | 'not_parsed_corrupt'
    | 'not_parsed_oversized'
    | 'not_parsed_quota_exceeded'
    | 'not_parsed_macro_rejected'
    | 'not_parsed_zip_bomb_rejected'
    | 'not_parsed_timeout'
    | 'not_parsed_unsupported';
  parseReason: string;
  extractedText: string | null;
  pageCount: number | null;
}

const MACRO_EXTENSION_REGEX = /\.(docm|dotm|xlsm|xltm|pptm|potm|vbs|js|exe|bat|cmd|ps1|scr)$/i;

/**
 * Safely inspects a ZIP buffer (for .docx) using Central Directory / Local File Header parsing
 * and Node's C++ `zlib.inflateRawSync` with `maxOutputLength` to defeat both declared and forged ZIP bombs.
 */
function parseDocxBufferSafely(buf: Buffer, limits: ParseLimits): LowLevelParseOutcome {
  // Walk local file headers (0x04034b50)
  let offset = 0;
  let entryCount = 0;
  let totalUncompressedBytes = 0;
  let hasContentTypes = false;
  let documentXmlText: string | null = null;

  while (offset + 30 <= buf.length) {
    const sig = buf.readUInt32LE(offset);
    if (sig === 0x02014b50 || sig === 0x06054b50) {
      // Reached Central Directory or End of Central Directory
      break;
    }
    if (sig !== 0x04034b50) {
      return {
        verifiedType: 'corrupt',
        parseStatus: 'not_parsed_corrupt',
        parseReason: 'Corrupt ZIP/DOCX container header; routed to manual review.',
        extractedText: null,
        pageCount: null,
      };
    }

    entryCount++;
    if (entryCount > limits.maxZipEntries) {
      return {
        verifiedType: 'docx',
        parseStatus: 'not_parsed_zip_bomb_rejected',
        parseReason: `Archive entry count exceeded safety limit (${limits.maxZipEntries}); rejected as potential ZIP bomb.`,
        extractedText: null,
        pageCount: null,
      };
    }

    const flags = buf.readUInt16LE(offset + 6);
    const compressionMethod = buf.readUInt16LE(offset + 8);
    const compressedSize = buf.readUInt32LE(offset + 18);
    const declaredUncompressedSize = buf.readUInt32LE(offset + 22);
    const fileNameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);

    // Encrypted ZIP entry bit (bit 0)
    if ((flags & 0x0001) !== 0) {
      return {
        verifiedType: 'docx',
        parseStatus: 'not_parsed_encrypted',
        parseReason: 'Encrypted/password-protected DOCX archive; routed to manual review.',
        extractedText: null,
        pageCount: null,
      };
    }

    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLen + extraLen;
    const dataEnd = dataStart + compressedSize;

    if (dataEnd > buf.length) {
      return {
        verifiedType: 'corrupt',
        parseStatus: 'not_parsed_corrupt',
        parseReason: 'Truncated or corrupt DOCX entry bounds; routed to manual review.',
        extractedText: null,
        pageCount: null,
      };
    }

    const entryName = buf.subarray(nameStart, nameStart + fileNameLen).toString('utf8');

    // Reject macro-enabled Office payloads (`vbaProject.bin`)
    if (/vbaProject\.bin$/i.test(entryName) || /^word\/vba/i.test(entryName)) {
      return {
        verifiedType: 'macro_rejected',
        parseStatus: 'not_parsed_macro_rejected',
        parseReason: 'Macro payload (vbaProject.bin) detected inside document; rejected for security.',
        extractedText: null,
        pageCount: null,
      };
    }

    if (declaredUncompressedSize > limits.maxDecompressedDocxBytes) {
      return {
        verifiedType: 'docx',
        parseStatus: 'not_parsed_zip_bomb_rejected',
        parseReason: 'Declared uncompressed entry size exceeds safety limit; rejected as potential ZIP bomb.',
        extractedText: null,
        pageCount: null,
      };
    }

    if (compressedSize > 0 && declaredUncompressedSize / compressedSize > limits.maxCompressionRatio) {
      return {
        verifiedType: 'docx',
        parseStatus: 'not_parsed_zip_bomb_rejected',
        parseReason: `Declared compression ratio exceeds ${limits.maxCompressionRatio}:1 safety ceiling; rejected as potential ZIP bomb.`,
        extractedText: null,
        pageCount: null,
      };
    }

    if (entryName === '[Content_Types].xml') {
      hasContentTypes = true;
    }

    // Only inflate XML files we actually inspect (`[Content_Types].xml` and `word/document.xml`),
    // while enforcing C++ `maxOutputLength` on EVERY inspected entry!
    if (entryName === '[Content_Types].xml' || entryName === 'word/document.xml') {
      const slice = buf.subarray(dataStart, dataEnd);
      const remainingBudget = limits.maxDecompressedDocxBytes - totalUncompressedBytes;
      if (remainingBudget <= 0) {
        return {
          verifiedType: 'docx',
          parseStatus: 'not_parsed_zip_bomb_rejected',
          parseReason: 'Cumulative decompressed size exceeded safety limit.',
          extractedText: null,
          pageCount: null,
        };
      }

      let inflated: Buffer;
      try {
        if (compressionMethod === 0) {
          if (slice.length > remainingBudget) {
            throw Object.assign(new Error('Output exceeds maxOutputLength'), { code: 'ERR_BUFFER_TOO_LARGE' });
          }
          inflated = slice;
        } else if (compressionMethod === 8) {
          inflated = zlib.inflateRawSync(slice, { maxOutputLength: remainingBudget });
        } else {
          return {
            verifiedType: 'unsupported',
            parseStatus: 'not_parsed_unsupported',
            parseReason: `Unsupported ZIP compression method (${compressionMethod}) in DOCX.`,
            extractedText: null,
            pageCount: null,
          };
        }
      } catch (err: any) {
        if (err?.code === 'ERR_BUFFER_TOO_LARGE' || /maxOutputLength|Cannot create a Buffer/i.test(String(err?.message))) {
          return {
            verifiedType: 'docx',
            parseStatus: 'not_parsed_zip_bomb_rejected',
            parseReason: 'Decompressed stream exceeded maxOutputLength safety limit; rejected as ZIP bomb.',
            extractedText: null,
            pageCount: null,
          };
        }
        return {
          verifiedType: 'corrupt',
          parseStatus: 'not_parsed_corrupt',
          parseReason: 'Failed to decompress DOCX XML stream; file may be corrupt.',
          extractedText: null,
          pageCount: null,
        };
      }

      totalUncompressedBytes += inflated.length;
      if (compressedSize > 0 && inflated.length / Math.max(compressedSize, 1) > limits.maxCompressionRatio && inflated.length > 65_536) {
        return {
          verifiedType: 'docx',
          parseStatus: 'not_parsed_zip_bomb_rejected',
          parseReason: `Actual inflation ratio (${Math.round(inflated.length / compressedSize)}:1) exceeded safety threshold; rejected as ZIP bomb.`,
          extractedText: null,
          pageCount: null,
        };
      }

      const xml = inflated.toString('utf8');
      // Block XML Entity Expansion (XXE / Billion Laughs)
      if (/<!ENTITY\s+/i.test(xml)) {
        return {
          verifiedType: 'corrupt',
          parseStatus: 'not_parsed_corrupt',
          parseReason: 'XML DTD entity declarations inside DOCX are disallowed (XXE defense).',
          extractedText: null,
          pageCount: null,
        };
      }

      if (entryName === '[Content_Types].xml' && /macroEnabled/i.test(xml)) {
        return {
          verifiedType: 'macro_rejected',
          parseStatus: 'not_parsed_macro_rejected',
          parseReason: 'Macro-enabled Office content type detected in [Content_Types].xml; rejected.',
          extractedText: null,
          pageCount: null,
        };
      }

      if (entryName === 'word/document.xml') {
        documentXmlText = xml
          .replace(/<\/w:p>/gi, '\n')
          .replace(/<w:tab\s*\/>/gi, '\t')
          .replace(/<w:br[^>]*\/>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/[ \t]+\n/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
      }
    }

    offset = dataEnd;
  }

  if (!hasContentTypes || documentXmlText === null) {
    return {
      verifiedType: 'unsupported',
      parseStatus: 'not_parsed_unsupported',
      parseReason: 'ZIP container is not a valid Word .docx document (missing word/document.xml).',
      extractedText: null,
      pageCount: null,
    };
  }

  if (documentXmlText.replace(/\s+/g, '').length < 15) {
    return {
      verifiedType: 'docx',
      parseStatus: 'not_parsed_scanned_or_image_only',
      parseReason: 'DOCX contains minimal or image-only content with <15 extractable text characters; manual review required.',
      extractedText: null,
      pageCount: null,
    };
  }

  const boundedText = documentXmlText.slice(0, limits.maxExtractedChars);
  return {
    verifiedType: 'docx',
    parseStatus: 'parsed',
    parseReason: 'Extracted text from verified DOCX archive without executing embedded content or external links.',
    extractedText: boundedText,
    pageCount: null,
  };
}

async function parsePdfBufferSafely(buf: Buffer, limits: ParseLimits): Promise<LowLevelParseOutcome> {
  // Check raw PDF bytes for `/Encrypt` dictionary before invoking parser
  const asciiScan = buf.toString('latin1');
  if (/\/Encrypt\b/.test(asciiScan)) {
    return {
      verifiedType: 'pdf',
      parseStatus: 'not_parsed_encrypted',
      parseReason: 'Encrypted or password-protected PDF detected (/Encrypt); manual officer review required.',
      extractedText: null,
      pageCount: null,
    };
  }

  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buf),
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      verbosity: 0,
    });

    const doc = await loadingTask.promise;
    const totalPages = doc.numPages;
    if (totalPages > limits.maxPdfPages) {
      await doc.destroy();
      return {
        verifiedType: 'pdf',
        parseStatus: 'not_parsed_oversized',
        parseReason: `PDF page count (${totalPages}) exceeds configured ${limits.maxPdfPages}-page safety limit; routed to manual review.`,
        extractedText: null,
        pageCount: totalPages,
      };
    }

    const pageTexts: string[] = [];
    let charCount = 0;

    for (let p = 1; p <= totalPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      let pageOut = '';
      let lastY: number | null = null;
      for (const item of content.items as Array<{ str?: string; hasEOL?: boolean; transform?: number[] }>) {
        const str = item.str || '';
        if (!str && !item.hasEOL) continue;
        const y = Array.isArray(item.transform) ? item.transform[5] : undefined;
        if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 3) {
          if (!pageOut.endsWith('\n')) pageOut += '\n';
        } else if (pageOut && !pageOut.endsWith('\n') && !pageOut.endsWith(' ')) {
          pageOut += ' ';
        }
        pageOut += str;
        if (item.hasEOL && !pageOut.endsWith('\n')) {
          pageOut += '\n';
        }
        if (y !== undefined) {
          lastY = y;
        }
      }
      const strings = pageOut
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (strings) {
        pageTexts.push(strings);
        charCount += strings.length;
        if (charCount >= limits.maxExtractedChars) break;
      }
    }
    await doc.destroy();

    const joined = pageTexts.join('\n\n').slice(0, limits.maxExtractedChars).trim();
    if (joined.replace(/\s+/g, '').length < 20) {
      return {
        verifiedType: 'pdf',
        parseStatus: 'not_parsed_scanned_or_image_only',
        parseReason:
          'Scanned or image-only PDF (<20 extractable characters across pages); OCR is not enabled in v1 — routed to manual review.',
        extractedText: null,
        pageCount: totalPages,
      };
    }

    return {
      verifiedType: 'pdf',
      parseStatus: 'parsed',
      parseReason: `Extracted plain text from ${totalPages}-page PDF safely (isEvalSupported=false).`,
      extractedText: joined,
      pageCount: totalPages,
    };
  } catch (err: any) {
    const msg = String(err?.message || err || '');
    if (/PasswordException|password|encrypt/i.test(msg)) {
      return {
        verifiedType: 'pdf',
        parseStatus: 'not_parsed_encrypted',
        parseReason: 'Password-protected PDF; manual review required.',
        extractedText: null,
        pageCount: null,
      };
    }
    return {
      verifiedType: 'corrupt',
      parseStatus: 'not_parsed_corrupt',
      parseReason: 'Corrupt or unreadable PDF structure; routed to manual review.',
      extractedText: null,
      pageCount: null,
    };
  }
}

export async function parseAttachmentBufferLowLevel(
  buf: Buffer,
  metadata: { filename: string; declaredMime?: string | null; simulateHangMs?: number },
  limits: ParseLimits
): Promise<LowLevelParseOutcome> {
  if (metadata.simulateHangMs && metadata.simulateHangMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, metadata.simulateHangMs));
  }

  if (buf.length > limits.maxAttachmentBytes) {
    return {
      verifiedType: 'unsupported',
      parseStatus: 'not_parsed_oversized',
      parseReason: `File size (${buf.length} bytes) exceeds maximum allowed limit (${limits.maxAttachmentBytes} bytes).`,
      extractedText: null,
      pageCount: null,
    };
  }

  if (
    MACRO_EXTENSION_REGEX.test(metadata.filename) ||
    (metadata.declaredMime && /macroEnabled|msdownload|x-msdos-program|javascript/i.test(metadata.declaredMime))
  ) {
    return {
      verifiedType: 'macro_rejected',
      parseStatus: 'not_parsed_macro_rejected',
      parseReason: `Rejected potentially executable or macro-enabled attachment ("${metadata.filename}").`,
      extractedText: null,
      pageCount: null,
    };
  }

  if (buf.length < 5) {
    return {
      verifiedType: 'corrupt',
      parseStatus: 'not_parsed_corrupt',
      parseReason: 'Attachment is empty or truncated (<5 bytes).',
      extractedText: null,
      pageCount: null,
    };
  }

  // Magic-byte inspection (never trust extension/MIME alone!)
  const headerAscii = buf.subarray(0, Math.min(buf.length, 64)).toString('latin1');
  const isPdfMagic = headerAscii.startsWith('%PDF-');
  const isZipMagic = buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;

  if (isPdfMagic) {
    return parsePdfBufferSafely(buf, limits);
  }

  if (isZipMagic) {
    return parseDocxBufferSafely(buf, limits);
  }

  // If extension claimed .pdf or .docx without matching magic bytes, flag as corrupt/spoofed!
  if (/\.(pdf|docx)$/i.test(metadata.filename)) {
    return {
      verifiedType: 'corrupt',
      parseStatus: 'not_parsed_corrupt',
      parseReason: `File extension ("${metadata.filename}") did not match binary magic header; rejected and routed to manual review.`,
      extractedText: null,
      pageCount: null,
    };
  }

  return {
    verifiedType: 'unsupported',
    parseStatus: 'not_parsed_unsupported',
    parseReason: `Unsupported attachment format ("${metadata.filename}"). v1 supports text-based PDF and DOCX only; manual review required.`,
    extractedText: null,
    pageCount: null,
  };
}
