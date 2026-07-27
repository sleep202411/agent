import {
  Injectable,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { MediaStorageProvider } from '@prisma/client';
import JSZip from 'jszip';
import { extractRawText } from 'mammoth';
import { createHash } from 'node:crypto';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import {
  MediaStorageAccessService,
  type MediaStorageReadUrlResult,
} from '../infra/storage/media-storage-access.service';
import { StudioAgentDocumentParserRunner } from './studio-agent-document-parser-runner';

export const STUDIO_AGENT_DOCUMENT_MEDIA_TYPES = [
  'text/plain',
  'text/markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/pdf',
] as const;
export type StudioAgentDocumentMediaType =
  (typeof STUDIO_AGENT_DOCUMENT_MEDIA_TYPES)[number];

export const STUDIO_AGENT_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const STUDIO_AGENT_DOCUMENT_MAX_TEXT_CHARS = 200_000;
export const STUDIO_AGENT_DOCUMENT_MAX_PDF_PAGES = 200;
const MAX_DOCX_ENTRIES = 2_000;
const MAX_DOCX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_DOCX_COMPRESSION_RATIO = 100;
const READ_TTL_SECONDS = 10 * 60;
export const STUDIO_AGENT_DOCUMENT_DOWNLOAD_TIMEOUT_MS = 60_000;
const parsePdf = pdfParse as unknown as (
  bytes: Buffer,
  options: { max: number },
) => Promise<{ numpages: number; text: string }>;

export interface StudioAgentDocumentAsset {
  storageProvider: MediaStorageProvider;
  bucket: string | null;
  region: string | null;
  objectKey: string | null;
  externalUrl: string | null;
  contentType: string;
  sizeBytes: bigint | null;
}

export interface StudioAgentDocumentProjection {
  schemaVersion: 1;
  mediaType: StudioAgentDocumentMediaType;
  text: string;
  charCount: number;
  pageCount: number | null;
  source: {
    byteCount: number;
    sha256: string;
    sniffed: true;
  };
}

@Injectable()
export class StudioAgentDocumentService {
  constructor(
    private readonly storage: MediaStorageAccessService,
    private readonly parser: StudioAgentDocumentParserRunner,
  ) {}

  async extract(
    asset: StudioAgentDocumentAsset,
    fileName: string,
  ): Promise<StudioAgentDocumentProjection> {
    const expectedSize = Number(asset.sizeBytes);
    if (
      !Number.isSafeInteger(expectedSize) ||
      expectedSize <= 0 ||
      expectedSize > STUDIO_AGENT_DOCUMENT_MAX_BYTES
    ) {
      throw documentTooLarge(expectedSize);
    }
    let signed: MediaStorageReadUrlResult;
    try {
      signed = await this.storage.createReadUrl(asset, {
        expiresInSeconds: READ_TTL_SECONDS,
      });
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw documentStorageUnavailable();
    }
    if (
      signed.bucket !== asset.bucket ||
      signed.objectKey !== asset.objectKey
    ) {
      throw new ServiceUnavailableException({
        code: 'STUDIO_AGENT_DOCUMENT_STORAGE_IDENTITY_MISMATCH',
        message: 'Media storage returned a different document object identity.',
      });
    }
    const bytes = await downloadBounded(signed.url, expectedSize);
    return this.parser.parse({
      fileName,
      declaredMediaType: asset.contentType,
      bytes,
    });
  }
}

export async function extractStudioAgentDocument(input: {
  fileName: string;
  declaredMediaType: string;
  bytes: Buffer;
}): Promise<StudioAgentDocumentProjection> {
  if (
    input.bytes.length === 0 ||
    input.bytes.length > STUDIO_AGENT_DOCUMENT_MAX_BYTES
  ) {
    throw documentTooLarge(input.bytes.length);
  }
  const mediaType = sniffDocumentMediaType(
    input.fileName,
    input.declaredMediaType,
    input.bytes,
  );
  let text: string;
  let pageCount: number | null = null;
  switch (mediaType) {
    case 'text/plain':
    case 'text/markdown':
      text = decodeUtf8(input.bytes);
      break;
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      await assertSafeDocx(input.bytes);
      try {
        text = (await extractRawText({ buffer: input.bytes })).value;
      } catch {
        throw documentParseFailed('DOCX');
      }
      break;
    case 'application/pdf': {
      let parsed: Awaited<ReturnType<typeof parsePdf>>;
      try {
        parsed = await parsePdf(input.bytes, {
          max: STUDIO_AGENT_DOCUMENT_MAX_PDF_PAGES + 1,
        });
      } catch {
        throw documentParseFailed('PDF');
      }
      const parsedPageCount = parsed.numpages;
      pageCount = parsedPageCount;
      if (parsedPageCount > STUDIO_AGENT_DOCUMENT_MAX_PDF_PAGES) {
        throw new PayloadTooLargeException({
          code: 'STUDIO_AGENT_DOCUMENT_TOO_MANY_PAGES',
          message: `PDF files must contain ${STUDIO_AGENT_DOCUMENT_MAX_PDF_PAGES} pages or fewer.`,
          maximumPages: STUDIO_AGENT_DOCUMENT_MAX_PDF_PAGES,
          actualPages: parsedPageCount,
        });
      }
      text = parsed.text;
      break;
    }
  }
  text = normalizeText(text);
  if (text.trim().length === 0) {
    throw new UnprocessableEntityException({
      code: 'STUDIO_AGENT_DOCUMENT_EMPTY',
      message: 'The file contains no extractable text.',
    });
  }
  if (text.length > STUDIO_AGENT_DOCUMENT_MAX_TEXT_CHARS) {
    throw new PayloadTooLargeException({
      code: 'STUDIO_AGENT_DOCUMENT_TEXT_TOO_LARGE',
      message: `The extracted text exceeds the ${STUDIO_AGENT_DOCUMENT_MAX_TEXT_CHARS.toLocaleString('en-US')}-character limit.`,
      maximumCharacters: STUDIO_AGENT_DOCUMENT_MAX_TEXT_CHARS,
      actualCharacters: text.length,
    });
  }
  return {
    schemaVersion: 1,
    mediaType,
    text,
    charCount: text.length,
    pageCount,
    source: {
      byteCount: input.bytes.length,
      sha256: createHash('sha256').update(input.bytes).digest('hex'),
      sniffed: true,
    },
  };
}

function sniffDocumentMediaType(
  fileName: string,
  declared: string,
  bytes: Buffer,
): StudioAgentDocumentMediaType {
  const normalized = declared.trim().toLowerCase();
  const extension = fileName.toLowerCase().match(/\.[^.]+$/)?.[0] ?? '';
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
    [0x03, 0x05, 0x07].includes(bytes[2]) &&
    [0x04, 0x06, 0x08].includes(bytes[3]);
  if (
    (expected === 'application/pdf' && !isPdf) ||
    (expected ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' &&
      !isZip) ||
    ((expected === 'text/plain' || expected === 'text/markdown') &&
      (isPdf || isZip || bytes.includes(0)))
  ) {
    throw new UnsupportedMediaTypeException({
      code: 'STUDIO_AGENT_DOCUMENT_MIME_MISMATCH',
      message: `The uploaded bytes do not match ${expected}.`,
    });
  }
  return expected;
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

function decodeUtf8(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new UnprocessableEntityException({
      code: 'STUDIO_AGENT_DOCUMENT_ENCODING_INVALID',
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

async function downloadBounded(url: string, expectedSize: number) {
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(STUDIO_AGENT_DOCUMENT_DOWNLOAD_TIMEOUT_MS),
    });
  } catch {
    throw documentStorageUnavailable();
  }
  if (!response.ok || !response.body) throw documentStorageUnavailable();
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = Buffer.from(result.value);
      total += chunk.length;
      if (total > expectedSize || total > STUDIO_AGENT_DOCUMENT_MAX_BYTES) {
        await reader.cancel();
        throw documentTooLarge(total);
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof PayloadTooLargeException) throw error;
    throw documentStorageUnavailable();
  }
  if (total !== expectedSize) {
    throw new UnprocessableEntityException({
      code: 'STUDIO_AGENT_DOCUMENT_SIZE_MISMATCH',
      message: 'The stored document size changed before it could be parsed.',
      expectedBytes: expectedSize,
      actualBytes: total,
    });
  }
  return Buffer.concat(chunks, total);
}

function unsupportedDocument() {
  return new UnsupportedMediaTypeException({
    code: 'STUDIO_AGENT_DOCUMENT_TYPE_UNSUPPORTED',
    message: 'Only UTF-8 TXT, Markdown, DOCX, and PDF files are supported.',
    supportedMediaTypes: [...STUDIO_AGENT_DOCUMENT_MEDIA_TYPES],
  });
}

function unsafeDocx() {
  return new UnprocessableEntityException({
    code: 'STUDIO_AGENT_DOCUMENT_ARCHIVE_UNSAFE',
    message: 'The DOCX archive exceeds safe expansion limits.',
  });
}

function documentParseFailed(kind: string) {
  return new UnprocessableEntityException({
    code: 'STUDIO_AGENT_DOCUMENT_PARSE_FAILED',
    message: `The ${kind} file could not be safely parsed. Re-export it and try again.`,
  });
}

function documentTooLarge(actualBytes: number) {
  return new PayloadTooLargeException({
    code: 'STUDIO_AGENT_DOCUMENT_FILE_TOO_LARGE',
    message: 'Document files must be 10MB or smaller.',
    maximumBytes: STUDIO_AGENT_DOCUMENT_MAX_BYTES,
    actualBytes,
  });
}

function documentStorageUnavailable() {
  return new ServiceUnavailableException({
    code: 'STUDIO_AGENT_DOCUMENT_STORAGE_UNAVAILABLE',
    message: 'The uploaded document could not be read from media storage.',
  });
}
