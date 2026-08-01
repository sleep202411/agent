import {
  HttpException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import JSZip from 'jszip';
import { extractRawText } from 'mammoth';
import { createHash } from 'node:crypto';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

export const AGENT_ATTACHMENT_MODEL_FILE_MEDIA_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
export const AGENT_ATTACHMENT_TEXT_MEDIA_TYPES = [
  'text/plain',
  'text/markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;
export const AGENT_ATTACHMENT_DOCUMENT_MEDIA_TYPES = [
  'application/pdf',
  ...AGENT_ATTACHMENT_TEXT_MEDIA_TYPES,
] as const;
export const AGENT_ATTACHMENT_IMAGE_MAX_BYTES = 30 * 1024 * 1024;
export const AGENT_ATTACHMENT_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const AGENT_ATTACHMENT_DOCUMENT_MAX_TEXT_CHARS = 200_000;
export const AGENT_ATTACHMENT_DOCUMENT_MAX_PDF_PAGES = 200;

const MAX_DOCX_ENTRIES = 2_000;
const MAX_DOCX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_DOCX_COMPRESSION_RATIO = 100;
const parsePdf = pdfParse as unknown as (
  bytes: Buffer,
  options: { max: number },
) => Promise<{ numpages: number; text: string }>;

export type AgentAttachmentDocumentProjection =
  | Readonly<{
      kind: 'model_file';
      contentHash: string;
    }>
  | Readonly<{
      kind: 'document_text';
      text: string;
      charCount: number;
      pageCount: number | null;
      contentHash: string;
    }>;

export async function inspectAgentAttachmentDocument(input: {
  fileName: string;
  declaredMediaType: string;
  bytes: Buffer;
}): Promise<AgentAttachmentDocumentProjection> {
  if (
    input.bytes.length === 0 ||
    input.bytes.length > AGENT_ATTACHMENT_DOCUMENT_MAX_BYTES
  ) {
    throw documentTooLarge(input.bytes.length);
  }
  const mediaType = sniffDocumentMediaType(
    input.fileName,
    input.declaredMediaType,
    input.bytes,
  );
  const contentHash = createHash('sha256').update(input.bytes).digest('hex');

  if (mediaType === 'application/pdf') {
    let parsed: Awaited<ReturnType<typeof parsePdf>>;
    try {
      // pdf.js 1.x can misread a pooled Node Buffer whose underlying
      // ArrayBuffer contains unrelated bytes before/after the Buffer view.
      // Give it an exact, zero-offset byte view so xref offsets are evaluated
      // against the uploaded PDF and never against the allocator slab.
      parsed = await parsePdf(Uint8Array.from(input.bytes) as never, {
        max: AGENT_ATTACHMENT_DOCUMENT_MAX_PDF_PAGES + 1,
      });
    } catch {
      throw documentParseFailed('PDF');
    }
    if (parsed.numpages > AGENT_ATTACHMENT_DOCUMENT_MAX_PDF_PAGES) {
      throw new PayloadTooLargeException({
        code: 'AGENT_ATTACHMENT_DOCUMENT_TOO_MANY_PAGES',
        message: `PDF files must contain ${AGENT_ATTACHMENT_DOCUMENT_MAX_PDF_PAGES} pages or fewer.`,
        maximumPages: AGENT_ATTACHMENT_DOCUMENT_MAX_PDF_PAGES,
        actualPages: parsed.numpages,
      });
    }
    const text = normalizeText(parsed.text);
    if (text.trim().length === 0) {
      throw new UnprocessableEntityException({
        code: 'AGENT_ATTACHMENT_PDF_OCR_REQUIRED',
        message:
          'This PDF contains no extractable text. OCR is not available in this deployment; upload a searchable PDF, TXT, Markdown, or DOCX file.',
        retryable: false,
        pages: parsed.numpages,
      });
    }
    assertTextWithinLimit(text);
    return {
      kind: 'document_text',
      text,
      charCount: text.length,
      pageCount: parsed.numpages,
      contentHash,
    };
  }

  let text: string;
  if (mediaType === 'text/plain' || mediaType === 'text/markdown') {
    text = decodeUtf8(input.bytes);
  } else {
    await assertSafeDocx(input.bytes);
    try {
      text = (await extractRawText({ buffer: input.bytes })).value;
    } catch {
      throw documentParseFailed('DOCX');
    }
  }
  text = normalizeText(text);
  if (text.trim().length === 0) {
    throw new UnprocessableEntityException({
      code: 'AGENT_ATTACHMENT_DOCUMENT_EMPTY',
      message: 'The file contains no extractable text.',
    });
  }
  assertTextWithinLimit(text);
  return {
    kind: 'document_text',
    text,
    charCount: text.length,
    pageCount: null,
    contentHash,
  };
}

function assertTextWithinLimit(text: string): void {
  if (text.length <= AGENT_ATTACHMENT_DOCUMENT_MAX_TEXT_CHARS) return;
  throw new PayloadTooLargeException({
    code: 'AGENT_ATTACHMENT_DOCUMENT_TEXT_TOO_LARGE',
    message: `The extracted text exceeds the ${AGENT_ATTACHMENT_DOCUMENT_MAX_TEXT_CHARS.toLocaleString('en-US')}-character limit.`,
    maximumCharacters: AGENT_ATTACHMENT_DOCUMENT_MAX_TEXT_CHARS,
    actualCharacters: text.length,
  });
}

async function assertSafeDocx(bytes: Buffer): Promise<void> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes, {
      checkCRC32: true,
      createFolders: false,
    });
  } catch {
    throw documentParseFailed('DOCX');
  }
  const entries = Object.values(zip.files);
  if (entries.length > MAX_DOCX_ENTRIES) throw unsafeDocx();
  let expanded = 0;
  for (const entry of entries) {
    const metadata = entry as unknown as {
      dir: boolean;
      _data?: { compressedSize?: number; uncompressedSize?: number };
    };
    if (metadata.dir) continue;
    const compressed = metadata._data?.compressedSize;
    const uncompressed = metadata._data?.uncompressedSize;
    if (
      typeof compressed !== 'number' ||
      typeof uncompressed !== 'number' ||
      !Number.isSafeInteger(compressed) ||
      !Number.isSafeInteger(uncompressed) ||
      compressed < 0 ||
      uncompressed < 0
    ) {
      throw unsafeDocx();
    }
    expanded += uncompressed;
    if (
      expanded > MAX_DOCX_UNCOMPRESSED_BYTES ||
      (uncompressed > 1024 &&
        uncompressed / Math.max(1, compressed) > MAX_DOCX_COMPRESSION_RATIO)
    ) {
      throw unsafeDocx();
    }
  }
  const documentXml = zip.file('word/document.xml');
  if (!documentXml) throw documentParseFailed('DOCX');
  const xml = await documentXml.async('string');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw unsafeDocx();
}

function sniffDocumentMediaType(
  fileName: string,
  declared: string,
  bytes: Buffer,
): (typeof AGENT_ATTACHMENT_DOCUMENT_MEDIA_TYPES)[number] {
  const normalized = declared.trim().toLowerCase();
  const extension = fileName.toLowerCase().match(/\.[^.]+$/u)?.[0] ?? '';
  const expected =
    extension === '.txt'
      ? 'text/plain'
      : extension === '.md' || extension === '.markdown'
        ? 'text/markdown'
        : extension === '.docx'
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : extension === '.pdf'
            ? 'application/pdf'
            : null;
  if (!expected || normalized !== expected) throw unsupportedDocument();

  const isPdf = bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  const isZip =
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    [0x03, 0x05, 0x07].includes(bytes[2] ?? -1) &&
    [0x04, 0x06, 0x08].includes(bytes[3] ?? -1);
  if (
    (expected === 'application/pdf' && !isPdf) ||
    (expected ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' &&
      !isZip) ||
    ((expected === 'text/plain' || expected === 'text/markdown') &&
      (isPdf || isZip || bytes.includes(0)))
  ) {
    throw new UnsupportedMediaTypeException({
      code: 'AGENT_ATTACHMENT_DOCUMENT_MIME_MISMATCH',
      message: `The uploaded bytes do not match ${expected}.`,
    });
  }
  return expected;
}

function decodeUtf8(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new UnprocessableEntityException({
      code: 'AGENT_ATTACHMENT_DOCUMENT_ENCODING_INVALID',
      message: 'Text attachments must be valid UTF-8.',
    });
  }
}

function normalizeText(text: string): string {
  return text
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .normalize('NFC')
    .replace(/\s+$/u, '');
}

function unsupportedDocument(): HttpException {
  return new UnsupportedMediaTypeException({
    code: 'AGENT_ATTACHMENT_DOCUMENT_TYPE_UNSUPPORTED',
    message: 'Only UTF-8 TXT, Markdown, DOCX, and PDF files are supported.',
    supportedMediaTypes: [...AGENT_ATTACHMENT_DOCUMENT_MEDIA_TYPES],
  });
}

function unsafeDocx(): HttpException {
  return new UnprocessableEntityException({
    code: 'AGENT_ATTACHMENT_DOCUMENT_ARCHIVE_UNSAFE',
    message: 'The DOCX archive exceeds safe expansion limits.',
  });
}

function documentParseFailed(kind: string): HttpException {
  return new UnprocessableEntityException({
    code: 'AGENT_ATTACHMENT_DOCUMENT_PARSE_FAILED',
    message: `The ${kind} file could not be safely parsed. Re-export it and try again.`,
  });
}

function documentTooLarge(actualBytes: number): HttpException {
  return new PayloadTooLargeException({
    code: 'AGENT_ATTACHMENT_DOCUMENT_FILE_TOO_LARGE',
    message: 'Document files must be 10MB or smaller.',
    maximumBytes: AGENT_ATTACHMENT_DOCUMENT_MAX_BYTES,
    actualBytes,
  });
}
