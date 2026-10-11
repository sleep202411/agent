import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpException } from '@nestjs/common';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  COPILOT_DOCUMENT_MAX_FILE_BYTES,
  COPILOT_DOCUMENT_MAX_PER_CONVERSATION,
  COPILOT_DOCUMENT_MAX_TEXT_CHARS,
  type CopilotDocumentRef,
} from '@repo/shared';
import {
  CopilotDocumentService,
  decodeUploadFilename,
  extractCopilotDocumentText,
  type CopilotDocumentUploadFile,
} from './copilot-document.service';

const USER_ID = 'user-1';
const CONVERSATION_ID = 'story-canvas:019f7243-20c1-7054-a6fa-0a33da6efef3';
const DOCUMENT_ID = '019f7243-20c1-7054-a6fa-0a33da6efe10';

function upload(
  name: string,
  content: Buffer | string,
  size?: number,
): CopilotDocumentUploadFile {
  const buffer = Buffer.isBuffer(content)
    ? content
    : Buffer.from(content, 'utf8');
  return { originalname: name, size: size ?? buffer.byteLength, buffer };
}

function errorBody(error: unknown): Record<string, unknown> {
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getResponse() as Record<string, unknown>;
}

async function extractionError(
  file: CopilotDocumentUploadFile,
): Promise<Record<string, unknown>> {
  try {
    await extractCopilotDocumentText(file);
  } catch (error) {
    return errorBody(error);
  }
  throw new Error('Expected extraction to reject.');
}

describe('extractCopilotDocumentText', () => {
  it('keeps DOCX headings and table rows separate from adjacent text', async () => {
    const entries = unzipSync(
      readFileSync(join(__dirname, '__fixtures__', 'sample-script.docx')),
    );
    entries['word/styles.xml'] = strToU8(
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>',
    );
    entries['word/_rels/document.xml.rels'] = strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    );
    const paragraph = (text: string, heading = false) =>
      `<w:p>${heading ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;
    entries['word/document.xml'] = strToU8(
      strFromU8(entries['word/document.xml']).replace(
        /<w:body>[\s\S]*<\/w:body>/,
        `<w:body>${paragraph('角色设定', true)}${paragraph('阿晴穿黄色雨衣。')}${paragraph('场景一 小巷', true)}${paragraph('阿晴拾起铜铃。')}<w:tbl><w:tr><w:tc>${paragraph('道具')}</w:tc><w:tc>${paragraph('铜铃')}</w:tc></w:tr><w:tr><w:tc>${paragraph('场景')}</w:tc><w:tc>${paragraph('蓝门')}</w:tc></w:tr></w:tbl></w:body>`,
      ),
    );
    const { text } = await extractCopilotDocumentText(
      upload('screenplay.docx', Buffer.from(zipSync(entries))),
    );
    expect(
      text
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean),
    ).toEqual([
      '角色设定',
      '阿晴穿黄色雨衣。',
      '场景一 小巷',
      '阿晴拾起铜铃。',
      '道具',
      '铜铃',
      '场景',
      '蓝门',
    ]);
  });
  it('extracts a real docx script preserving paragraph and soft-line-break structure', async () => {
    const buffer = readFileSync(
      join(__dirname, '__fixtures__', 'sample-script.docx'),
    );
    // Simulate busboy: browsers send UTF-8 filenames, busboy decodes latin1.
    const busboyName = Buffer.from('剧本 Sample.docx', 'utf8').toString(
      'latin1',
    );
    const extracted = await extractCopilotDocumentText(
      upload(busboyName, buffer),
    );
    expect(extracted.mediaType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(extracted.name).toBe('剧本 Sample.docx');
    // <w:br/> soft breaks must survive as line boundaries — extractRawText
    // regression: screenplays collapse to one line without them.
    expect(extracted.text).toBe(
      'INT. FOREST GATE - NIGHT\nThe gate creaks open.\nLIN: Who goes there?',
    );
  });

  it('keeps txt verbatim while normalizing BOM and line endings', async () => {
    const buffer = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('Line one\r\nLine two\rLine three\n\n', 'utf8'),
    ]);
    const extracted = await extractCopilotDocumentText(
      upload('notes.TXT', buffer),
    );
    expect(extracted.mediaType).toBe('text/plain');
    expect(extracted.text).toBe('Line one\nLine two\nLine three');
  });

  it('decodes UTF-16LE text files by BOM', async () => {
    const buffer = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('大纲：第一幕', 'utf16le'),
    ]);
    const extracted = await extractCopilotDocumentText(
      upload('outline.md', buffer),
    );
    expect(extracted.mediaType).toBe('text/markdown');
    expect(extracted.text).toBe('大纲：第一幕');
  });

  it('rejects invalid UTF-8 with the typed encoding error', async () => {
    const body = await extractionError(
      upload('broken.txt', Buffer.from([0xc3, 0x28, 0xa0, 0xa1])),
    );
    expect(body.code).toBe('COPILOT_DOCUMENT_ENCODING_INVALID');
  });

  it('rejects unsupported extensions with the supported list', async () => {
    const body = await extractionError(upload('script.pdf', 'not really'));
    expect(body.code).toBe('COPILOT_DOCUMENT_TYPE_UNSUPPORTED');
    expect(body.supportedExtensions).toEqual(['.docx', '.md', '.txt']);
  });

  it('rejects files over the byte cap with the limit in the error', async () => {
    const body = await extractionError(
      upload('big.txt', 'x', COPILOT_DOCUMENT_MAX_FILE_BYTES + 1),
    );
    expect(body.code).toBe('COPILOT_DOCUMENT_FILE_TOO_LARGE');
    expect(body.maximumBytes).toBe(COPILOT_DOCUMENT_MAX_FILE_BYTES);
  });

  it('rejects oversized extracted text with the character limit — never truncates', async () => {
    const body = await extractionError(
      upload('long.md', 'a'.repeat(COPILOT_DOCUMENT_MAX_TEXT_CHARS + 1)),
    );
    expect(body.code).toBe('COPILOT_DOCUMENT_TEXT_TOO_LARGE');
    expect(body.maximumCharacters).toBe(COPILOT_DOCUMENT_MAX_TEXT_CHARS);
    expect(body.actualCharacters).toBe(COPILOT_DOCUMENT_MAX_TEXT_CHARS + 1);
  });

  it('rejects documents with no extractable text', async () => {
    const body = await extractionError(upload('empty.txt', '   \n\n  '));
    expect(body.code).toBe('COPILOT_DOCUMENT_EMPTY');
  });

  it('rejects an unreadable docx with the typed parse error', async () => {
    const body = await extractionError(
      upload('corrupt.docx', Buffer.from('this is not a zip archive')),
    );
    expect(body.code).toBe('COPILOT_DOCUMENT_PARSE_FAILED');
  });
});

describe('decodeUploadFilename', () => {
  it('restores UTF-8 filenames that busboy decoded as latin1', () => {
    const mojibake = Buffer.from('无字来客.docx', 'utf8').toString('latin1');
    expect(decodeUploadFilename(mojibake)).toBe('无字来客.docx');
  });

  it('keeps plain ASCII names untouched', () => {
    expect(decodeUploadFilename('script-final.docx')).toBe('script-final.docx');
  });

  it('never mangles a name that is already proper Unicode', () => {
    expect(decodeUploadFilename('剧本 Sample.docx')).toBe('剧本 Sample.docx');
  });
});

describe('CopilotDocumentService', () => {
  it('applies the App text ceiling only when explicitly requested', async () => {
    const create = jest
      .fn()
      .mockImplementation(({ data }) =>
        Promise.resolve({ id: DOCUMENT_ID, ...data }),
      );
    const service = serviceWith({
      copilotDocument: { count: jest.fn().mockResolvedValue(0), create },
    });
    const input = {
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      file: upload('outline.txt', 'a'.repeat(40_001)),
    };
    await expect(
      service.create({ ...input, maximumTextCharacters: 40_000 }),
    ).rejects.toMatchObject({ response: { code: 'DOCUMENT_TEXT_TOO_LARGE' } });
    expect(create).not.toHaveBeenCalled();
    await expect(service.create(input)).resolves.toMatchObject({
      charCount: 40_001,
    });
  });

  function serviceWith(prisma: Record<string, unknown>) {
    return new CopilotDocumentService({
      ...prisma,
      $transaction: (run: (tx: unknown) => Promise<unknown>) =>
        run({ ...prisma, $executeRaw: jest.fn().mockResolvedValue(1) }),
    } as never);
  }

  it('stores the extracted document scoped to the conversation and returns the reference', async () => {
    const create = jest
      .fn()
      .mockImplementation(({ data }) =>
        Promise.resolve({ id: DOCUMENT_ID, ...data }),
      );
    const service = serviceWith({
      copilotDocument: { count: jest.fn().mockResolvedValue(0), create },
    });

    const ref = await service.create({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      file: upload('outline.md', '# Act I\nThe gate opens.'),
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        userId: USER_ID,
        conversationId: CONVERSATION_ID,
        name: 'outline.md',
        mediaType: 'text/markdown',
        sizeBytes: Buffer.byteLength('# Act I\nThe gate opens.'),
        charCount: '# Act I\nThe gate opens.'.length,
        text: '# Act I\nThe gate opens.',
      },
    });
    expect(ref).toEqual({
      documentId: DOCUMENT_ID,
      name: 'outline.md',
      mediaType: 'text/markdown',
      sizeBytes: Buffer.byteLength('# Act I\nThe gate opens.'),
      charCount: '# Act I\nThe gate opens.'.length,
    });
  });

  it('enforces the per-conversation document limit', async () => {
    const service = serviceWith({
      copilotDocument: {
        count: jest
          .fn()
          .mockResolvedValue(COPILOT_DOCUMENT_MAX_PER_CONVERSATION),
        create: jest.fn(),
      },
    });
    await expect(
      service.create({
        userId: USER_ID,
        conversationId: CONVERSATION_ID,
        file: upload('outline.md', 'content'),
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'COPILOT_DOCUMENT_LIMIT_REACHED',
        maximum: COPILOT_DOCUMENT_MAX_PER_CONVERSATION,
      }) as unknown,
    });
  });

  function storedRow() {
    return {
      id: DOCUMENT_ID,
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      name: 'outline.md',
      mediaType: 'text/markdown',
      sizeBytes: 24,
      charCount: 24,
      text: 'x'.repeat(24),
    };
  }

  function refFor(row = storedRow()): CopilotDocumentRef {
    return {
      documentId: row.id,
      name: row.name,
      mediaType: row.mediaType as CopilotDocumentRef['mediaType'],
      sizeBytes: row.sizeBytes,
      charCount: row.charCount,
    };
  }

  it('accepts references that byte-exactly match an owned row', async () => {
    const service = serviceWith({
      copilotDocument: {
        findMany: jest.fn().mockResolvedValue([storedRow()]),
      },
    });
    await expect(
      service.requireOwnedRefs(USER_ID, CONVERSATION_ID, [refFor()]),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['another user', { userId: 'user-2' }],
    ['another conversation', { conversationId: 'story-canvas:other' }],
    ['mismatched metadata', { charCount: 9 }],
  ])('rejects references owned by %s', async (_label, override) => {
    const service = serviceWith({
      copilotDocument: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ ...storedRow(), ...override }]),
      },
    });
    await expect(
      service.requireOwnedRefs(USER_ID, CONVERSATION_ID, [refFor()]),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'COPILOT_DOCUMENT_NOT_FOUND',
      }) as unknown,
    });
  });

  it('loads owned texts and fails loud on any missing document', async () => {
    const service = serviceWith({
      copilotDocument: {
        findMany: jest.fn().mockResolvedValue([storedRow()]),
      },
    });
    const texts = await service.loadOwnedTexts(USER_ID, CONVERSATION_ID, [
      DOCUMENT_ID,
    ]);
    expect(texts.get(DOCUMENT_ID)).toEqual({
      documentId: DOCUMENT_ID,
      name: 'outline.md',
      text: 'x'.repeat(24),
      charCount: 24,
    });

    await expect(
      service.loadOwnedTexts(USER_ID, CONVERSATION_ID, [
        DOCUMENT_ID,
        '019f7243-20c1-7054-a6fa-0a33da6efe99',
      ]),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'COPILOT_DOCUMENT_NOT_FOUND',
      }) as unknown,
    });
  });
});
