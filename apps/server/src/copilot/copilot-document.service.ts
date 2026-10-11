/**
 * Copilot conversation documents — send-time script/outline uploads for the
 * Story Canvas Director Agent.
 *
 * Text is extracted exactly once at upload (docx via mammoth; txt/md verbatim
 * with encoding normalization) and stored append-only, scoped to one user's
 * conversation. Chat messages carry only a small reference part; the server
 * injects the durable text into model context and the authoring run reads it
 * by documentId.
 */
import type { Prisma } from '@prisma/client';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  COPILOT_DOCUMENT_EXTENSIONS,
  COPILOT_DOCUMENT_MAX_FILE_BYTES,
  COPILOT_DOCUMENT_MAX_PER_CONVERSATION,
  COPILOT_DOCUMENT_MAX_TEXT_CHARS,
  COPILOT_DOCUMENT_MEDIA_TYPE_BY_EXTENSION,
  type CopilotDocumentMediaType,
  type CopilotDocumentRef,
} from '@repo/shared';
import { PrismaService } from '../infra/db/db.module';
import { extractDocxPlainText } from '../documents/docx-text';

export interface CopilotDocumentUploadFile {
  originalname: string;
  size: number;
  buffer: Buffer;
}

export interface CopilotDocumentText {
  documentId: string;
  name: string;
  text: string;
  charCount: number;
}

const MAX_NAME_CHARS = 255;

function documentError(
  code: string,
  message: string,
  status: HttpStatus,
  extra: Record<string, unknown> = {},
): HttpException {
  return new HttpException({ code, message, ...extra }, status);
}

export function copilotDocumentFileRequired(): HttpException {
  return documentError(
    'COPILOT_DOCUMENT_FILE_REQUIRED',
    'Attach one document file (.docx, .txt, or .md) as the "file" field.',
    HttpStatus.BAD_REQUEST,
  );
}

/**
 * Busboy decodes multipart filenames as latin1 while browsers send UTF-8, so
 * a CJK script name arrives mojibaked. Restore UTF-8 when the bytes decode
 * cleanly; otherwise keep the original name untouched.
 */
export function decodeUploadFilename(raw: string): string {
  // A busboy latin1-decoded name can only contain code units ≤ 0xFF; anything
  // beyond means the name is already proper Unicode — leave it untouched.
  if ([...raw].some((character) => character.charCodeAt(0) > 0xff)) return raw;
  const restored = Buffer.from(raw, 'latin1').toString('utf8');
  return restored.includes('�') ? raw : restored;
}

function documentExtension(
  name: string,
): (typeof COPILOT_DOCUMENT_EXTENSIONS)[number] | null {
  const lower = name.toLowerCase();
  for (const extension of COPILOT_DOCUMENT_EXTENSIONS) {
    if (lower.endsWith(extension)) return extension;
  }
  return null;
}

/** Bound the stored name without ever cutting the extension off. */
function normalizeDocumentName(name: string, extension: string): string {
  const trimmed = name.trim();
  if (trimmed.length <= MAX_NAME_CHARS) return trimmed;
  const base = trimmed.slice(0, MAX_NAME_CHARS - extension.length);
  return `${base}${extension}`;
}

function decodePlainText(buffer: Buffer): string {
  // UTF-16 BOMs first (Windows Notepad scripts), then strict UTF-8.
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buffer.subarray(2));
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buffer.subarray(2));
  }
  try {
    // TextDecoder skips a UTF-8 BOM by default.
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw documentError(
      'COPILOT_DOCUMENT_ENCODING_INVALID',
      'The text file is not valid UTF-8 (or UTF-16 with BOM). Re-save it as UTF-8 and upload again.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

function normalizeLineEndings(text: string): string {
  return text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

/**
 * Extract plain text from one uploaded document. Enforces the file-size cap,
 * the supported types, and the extracted-text cap — every rejection is a typed
 * error that tells the creator the exact limit. Text is never truncated.
 */
export async function extractCopilotDocumentText(
  file: CopilotDocumentUploadFile,
): Promise<{
  name: string;
  mediaType: CopilotDocumentMediaType;
  text: string;
}> {
  if (file.size > COPILOT_DOCUMENT_MAX_FILE_BYTES) {
    throw documentError(
      'COPILOT_DOCUMENT_FILE_TOO_LARGE',
      'Document files must be 10MB or smaller.',
      HttpStatus.PAYLOAD_TOO_LARGE,
      { maximumBytes: COPILOT_DOCUMENT_MAX_FILE_BYTES, actualBytes: file.size },
    );
  }
  const decodedName = decodeUploadFilename(file.originalname);
  const extension = documentExtension(decodedName);
  if (!extension) {
    throw documentError(
      'COPILOT_DOCUMENT_TYPE_UNSUPPORTED',
      'Only .docx, .txt, and .md documents are supported.',
      HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      { supportedExtensions: [...COPILOT_DOCUMENT_EXTENSIONS] },
    );
  }
  const mediaType = COPILOT_DOCUMENT_MEDIA_TYPE_BY_EXTENSION[extension];

  let text: string;
  if (extension === '.docx') {
    try {
      text = await extractDocxPlainText(file.buffer);
    } catch {
      throw documentError(
        'COPILOT_DOCUMENT_PARSE_FAILED',
        'The .docx file could not be read. Re-export it from your editor and upload again.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  } else {
    text = decodePlainText(file.buffer);
  }
  text = normalizeLineEndings(text).replace(/\s+$/u, '');
  if (text.trim().length === 0) {
    throw documentError(
      'COPILOT_DOCUMENT_EMPTY',
      'The document contains no extractable text.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  if (text.length > COPILOT_DOCUMENT_MAX_TEXT_CHARS) {
    throw documentError(
      'COPILOT_DOCUMENT_TEXT_TOO_LARGE',
      `The document extracts to ${text.length.toLocaleString('en-US')} characters; the limit is ${COPILOT_DOCUMENT_MAX_TEXT_CHARS.toLocaleString('en-US')}. Split the document and upload a part.`,
      HttpStatus.PAYLOAD_TOO_LARGE,
      {
        maximumCharacters: COPILOT_DOCUMENT_MAX_TEXT_CHARS,
        actualCharacters: text.length,
      },
    );
  }
  return {
    name: normalizeDocumentName(decodedName, extension),
    mediaType,
    text,
  };
}

@Injectable()
export class CopilotDocumentService {
  constructor(private readonly prisma: PrismaService) {}

  /** Extract and durably store one document for this user's conversation. */
  async create(input: {
    userId: string;
    conversationId: string;
    file: CopilotDocumentUploadFile;
    maximumTextCharacters?: number;
    transaction?: Prisma.TransactionClient;
  }): Promise<CopilotDocumentRef> {
    const extracted = await extractCopilotDocumentText(input.file);
    if (
      input.maximumTextCharacters &&
      extracted.text.length > input.maximumTextCharacters
    ) {
      throw documentError(
        'DOCUMENT_TEXT_TOO_LARGE',
        `This document exceeds the ${input.maximumTextCharacters}-character limit.`,
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }
    const persist = async (tx: Prisma.TransactionClient) => {
      const key = JSON.stringify([
        'copilot-document-limit',
        input.userId,
        input.conversationId,
      ]);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      const existing = await tx.copilotDocument.count({
        where: { userId: input.userId, conversationId: input.conversationId },
      });
      if (existing >= COPILOT_DOCUMENT_MAX_PER_CONVERSATION) {
        throw documentError(
          'COPILOT_DOCUMENT_LIMIT_REACHED',
          `This conversation has reached its ${COPILOT_DOCUMENT_MAX_PER_CONVERSATION}-document limit. Start a new conversation to upload more.`,
          HttpStatus.TOO_MANY_REQUESTS,
          { maximum: COPILOT_DOCUMENT_MAX_PER_CONVERSATION },
        );
      }
      return tx.copilotDocument.create({
        data: {
          userId: input.userId,
          conversationId: input.conversationId,
          name: extracted.name,
          mediaType: extracted.mediaType,
          sizeBytes: input.file.size,
          charCount: extracted.text.length,
          text: extracted.text,
        },
      });
    };
    const row = input.transaction
      ? await persist(input.transaction)
      : await this.prisma.$transaction(persist, {
          isolationLevel: 'ReadCommitted',
        });
    return {
      documentId: row.id,
      name: row.name,
      mediaType: extracted.mediaType,
      sizeBytes: row.sizeBytes,
      charCount: row.charCount,
    };
  }

  /**
   * Assert every client-authored reference resolves to a durable row owned by
   * this user inside this conversation, with byte-exact metadata. Called
   * before a turn is accepted so the canonical transcript never persists a
   * reference the server cannot honor.
   */
  async requireOwnedRefs(
    userId: string,
    conversationId: string,
    refs: readonly CopilotDocumentRef[],
  ): Promise<void> {
    if (refs.length === 0) return;
    const rows = await this.prisma.copilotDocument.findMany({
      where: { id: { in: refs.map((ref) => ref.documentId) } },
      select: {
        id: true,
        userId: true,
        conversationId: true,
        name: true,
        mediaType: true,
        sizeBytes: true,
        charCount: true,
      },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const ref of refs) {
      const row = byId.get(ref.documentId);
      if (
        !row ||
        row.userId !== userId ||
        row.conversationId !== conversationId ||
        row.name !== ref.name ||
        row.mediaType !== ref.mediaType ||
        row.sizeBytes !== ref.sizeBytes ||
        row.charCount !== ref.charCount
      ) {
        throw documentNotFound();
      }
    }
  }

  /** Load the full extracted text of owned documents for model injection. */
  async loadOwnedTexts(
    userId: string,
    conversationId: string,
    documentIds: readonly string[],
  ): Promise<Map<string, CopilotDocumentText>> {
    if (documentIds.length === 0) return new Map();
    const rows = await this.prisma.copilotDocument.findMany({
      where: { id: { in: [...documentIds] } },
    });
    const texts = new Map<string, CopilotDocumentText>();
    for (const row of rows) {
      if (row.userId !== userId || row.conversationId !== conversationId) {
        continue;
      }
      texts.set(row.id, {
        documentId: row.id,
        name: row.name,
        text: row.text,
        charCount: row.charCount,
      });
    }
    for (const documentId of documentIds) {
      if (!texts.has(documentId)) throw documentNotFound();
    }
    return texts;
  }
}

function documentNotFound(): HttpException {
  return documentError(
    'COPILOT_DOCUMENT_NOT_FOUND',
    'The referenced document does not exist in this conversation.',
    HttpStatus.NOT_FOUND,
  );
}
