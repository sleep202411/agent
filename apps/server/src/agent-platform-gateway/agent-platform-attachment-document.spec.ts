import { HttpException } from '@nestjs/common';
import JSZip from 'jszip';

import { buildStorySourceMaterialIndex } from '../agent-domain-gateway/story-source-material-index';
import { inspectAgentAttachmentDocument } from './agent-platform-attachment-document';

describe('Agent Platform attachment document inspection', () => {
  it('normalizes bounded UTF-8 text and hashes the source bytes', async () => {
    const result = await inspectAgentAttachmentDocument({
      fileName: 'outline.md',
      declaredMediaType: 'text/markdown',
      bytes: Buffer.from('# Outline\r\n\r\nScene one.  \r\n', 'utf8'),
    });
    expect(result).toMatchObject({
      kind: 'document_text',
      text: '# Outline\n\nScene one.',
      charCount: 21,
    });
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('extracts DOCX only after archive and XML safety checks', async () => {
    const zip = new JSZip();
    zip.file(
      '[Content_Types].xml',
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    );
    zip.file(
      '_rels/.rels',
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    );
    zip.file(
      'word/document.xml',
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Safe story text</w:t></w:r></w:p></w:body></w:document>',
    );
    zip.file(
      'word/_rels/document.xml.rels',
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
    );
    const bytes = await zip.generateAsync({ type: 'nodebuffer' });

    await expect(
      inspectAgentAttachmentDocument({
        fileName: 'script.docx',
        declaredMediaType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        bytes,
      }),
    ).resolves.toMatchObject({
      kind: 'document_text',
      text: 'Safe story text',
    });
  });

  it('rejects extension, declared type, and byte-signature disagreement', async () => {
    const error = await inspectAgentAttachmentDocument({
      fileName: 'not-a-pdf.pdf',
      declaredMediaType: 'application/pdf',
      bytes: Buffer.from('plain text', 'utf8'),
    }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getResponse()).toMatchObject({
      code: 'AGENT_ATTACHMENT_DOCUMENT_MIME_MISMATCH',
    });
  });

  it.each([65_000, 200_000])(
    'extracts and indexes a real %,d-character source without truncation',
    async (characterCount) => {
      const text = exactLengthStory(characterCount);
      const result = await inspectAgentAttachmentDocument({
        fileName: 'feature-screenplay.txt',
        declaredMediaType: 'text/plain',
        bytes: Buffer.from(text, 'utf8'),
      });
      expect(result).toMatchObject({
        kind: 'document_text',
        text,
        charCount: characterCount,
        pageCount: null,
      });
      if (result.kind !== 'document_text') {
        throw new Error('Expected a text projection.');
      }
      const index = buildStorySourceMaterialIndex({
        text: result.text,
        fileName: 'feature-screenplay.txt',
        contentHash: result.contentHash,
      });
      expect(index.document.characterCount).toBe(characterCount);
      expect(index.document.chunkCount).toBeGreaterThan(1);
      expect(index.chunks[0]?.start).toBe(0);
      expect(index.chunks.at(-1)?.end).toBe(characterCount);
      expect(
        index.chunks.every(
          (chunk, ordinal) =>
            chunk.ordinal === ordinal &&
            (ordinal === 0 || index.chunks[ordinal - 1]?.end === chunk.start),
        ),
      ).toBe(true);
    },
  );

  it('extracts searchable text and page count from a real PDF byte stream', async () => {
    const result = await inspectAgentAttachmentDocument({
      fileName: 'screenplay.pdf',
      declaredMediaType: 'application/pdf',
      bytes: minimalPdf('A searchable screenplay page.'),
    });
    expect(result).toMatchObject({
      kind: 'document_text',
      pageCount: 1,
    });
    if (result.kind !== 'document_text') {
      throw new Error('Expected a text projection.');
    }
    expect(result.text).toContain('A searchable screenplay page.');
  });

  it('reports an explicit actionable OCR status for an image-only PDF', async () => {
    const error = await inspectAgentAttachmentDocument({
      fileName: 'scanned-screenplay.pdf',
      declaredMediaType: 'application/pdf',
      bytes: minimalPdf(null),
    }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getResponse()).toMatchObject({
      code: 'AGENT_ATTACHMENT_PDF_OCR_REQUIRED',
      retryable: false,
      pages: 1,
    });
  });
});

function exactLengthStory(characterCount: number): string {
  const heading = 'INT. STUDIO - DAY\n\n';
  const paragraph =
    'A character enters, makes a consequential choice, and changes the story. ';
  let text = heading;
  while (text.length + paragraph.length <= characterCount) text += paragraph;
  return text + 'x'.repeat(characterCount - text.length);
}

function minimalPdf(text: string | null): Buffer {
  const escapedText = text
    ?.replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)');
  const stream =
    escapedText === undefined
      ? 'q\nQ'
      : `BT\n/F1 12 Tf\n72 720 Td\n(${escapedText}) Tj\nET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  body += `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}
