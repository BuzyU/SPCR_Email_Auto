import zlib from 'node:zlib';

/**
 * Generates a valid, spec-compliant `%PDF-1.4` binary containing extractable text across 1 or more pages,
 * or optional `/Encrypt` dictionary / zero-text scanned simulation for security & fallback tests.
 */
export function buildValidTextPdfBuffer(
  pages: string[][],
  options: { includeEncryptDict?: boolean } = {}
): Buffer {
  const escapePdfString = (s: string) =>
    s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

  const objects: string[] = [];
  // Obj 1: Catalog
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  const pageCount = Math.max(pages.length, 1);
  const firstPageObjNum = 4;
  const pageRefs: string[] = [];
  for (let i = 0; i < pageCount; i++) {
    pageRefs.push(`${firstPageObjNum + i * 2} 0 R`);
  }

  // Obj 2: Pages
  objects.push(`2 0 obj\n<< /Type /Pages /Kids [ ${pageRefs.join(' ')} ] /Count ${pageCount} >>\nendobj\n`);
  // Obj 3: Font
  objects.push('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');

  const normalizedPages = pages.length > 0 ? pages : [[]];
  for (let i = 0; i < normalizedPages.length; i++) {
    const pageObjNum = firstPageObjNum + i * 2;
    const contentObjNum = pageObjNum + 1;
    const lines = normalizedPages[i] || [];

    const streamLines: string[] = ['BT', '/F1 11 Tf', '50 750 Td'];
    for (let l = 0; l < lines.length; l++) {
      if (l > 0) streamLines.push('0 -16 Td');
      streamLines.push(`(${escapePdfString(lines[l]!)}) Tj`);
    }
    streamLines.push('ET');
    const streamBody = lines.length > 0 ? streamLines.join('\n') : '';

    objects.push(
      `${pageObjNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjNum} 0 R >>\nendobj\n`
    );
    objects.push(
      `${contentObjNum} 0 obj\n<< /Length ${Buffer.byteLength(streamBody, 'latin1')} >>\nstream\n${streamBody}\nendstream\nendobj\n`
    );
  }

  let encryptObjNum: number | null = null;
  if (options.includeEncryptDict) {
    encryptObjNum = objects.length + 1;
    objects.push(
      `${encryptObjNum} 0 obj\n<< /Filter /Standard /V 2 /R 3 /Length 128 >>\nendobj\n`
    );
  }

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += obj;
  }

  const xrefStart = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]!).padStart(10, '0')} 00000 n \n`;
  }

  const encryptTrailer = encryptObjNum ? ` /Encrypt ${encryptObjNum} 0 R` : '';
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${encryptTrailer} >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function buildZipArchiveFromEntries(
  entries: Array<{
    name: string;
    data: Buffer;
    compress?: boolean;
    encryptedFlag?: boolean;
    forgedUncompressedSize?: number;
  }>
): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const useDeflate = entry.compress !== false;
    const payload = useDeflate ? zlib.deflateRawSync(entry.data) : entry.data;
    const method = useDeflate ? 8 : 0;
    const flags = entry.encryptedFlag ? 0x0001 : 0x0000;
    const crc = crc32(entry.data);
    const uncompSize = entry.forgedUncompressedSize ?? entry.data.length;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(flags, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(uncompSize, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(flags, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(uncompSize, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);

    localParts.push(localHeader, nameBuf, payload);
    centralParts.push(centralHeader, nameBuf);
    localOffset += localHeader.length + nameBuf.length + payload.length;
  }

  const centralDirBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirBuf, eocd]);
}

export function buildValidDocxBuffer(
  paragraphs: string[],
  options: { includeMacroVba?: boolean; encrypted?: boolean } = {}
): Buffer {
  const escapeXml = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="${
    options.includeMacroVba
      ? 'application/vnd.ms-word.document.macroEnabled.main+xml'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
  }"/>
</Types>`;

  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs.map((p) => `<w:p><w:r><w:t>${escapeXml(p)}</w:t></w:r></w:p>`).join('\n    ')}
  </w:body>
</w:document>`;

  const entries: Array<{ name: string; data: Buffer; encryptedFlag?: boolean }> = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypesXml, 'utf8'), encryptedFlag: options.encrypted },
    { name: 'word/document.xml', data: Buffer.from(docXml, 'utf8'), encryptedFlag: options.encrypted },
  ];
  if (options.includeMacroVba) {
    entries.push({ name: 'word/vbaProject.bin', data: Buffer.from('FAKE_VBA_MACRO_STREAM', 'utf8') });
  }
  return buildZipArchiveFromEntries(entries);
}

