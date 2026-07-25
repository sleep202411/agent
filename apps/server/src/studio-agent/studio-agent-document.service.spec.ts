/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest asymmetric matchers are intentionally untyped. */
import JSZip from 'jszip';
import {
  STUDIO_AGENT_DOCUMENT_MAX_BYTES,
  extractStudioAgentDocument,
} from './studio-agent-document.service';

const DOCX_MEDIA_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function docx(
  body: string,
  image?: { relationshipId: string; bytes: Buffer },
): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        ${image ? '<Default Extension="png" ContentType="image/png"/>' : ''}
        <Override PartName="/word/document.xml" ContentType="${DOCX_MEDIA_TYPE}.main+xml"/>
      </Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rIdDocument" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
      </Relationships>`,
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <w:document
        xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
        xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
        xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
        xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
        <w:body>${body}<w:sectPr/></w:body>
      </w:document>`,
  );
  if (image) {
    zip.file(
      'word/_rels/document.xml.rels',
      `<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="${image.relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image.png"/>
        </Relationships>`,
    );
    zip.file('word/media/image.png', image.bytes);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('Studio Agent document extraction', () => {
  it('normalizes bounded UTF-8 text and derives security metadata', async () => {
    const bytes = Buffer.from('Scene one.\r\nScene two.  \r\n', 'utf8');
    await expect(
      extractStudioAgentDocument({
        fileName: 'outline.md',
        declaredMediaType: 'text/markdown',
        bytes,
      }),
    ).resolves.toMatchObject({
      schemaVersion: 1,
      mediaType: 'text/markdown',
      text: 'Scene one.\nScene two.',
      charCount: 21,
      source: {
        byteCount: bytes.length,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        sniffed: true,
      },
    });
  });

  it('rejects MIME spoofing instead of trusting the extension or header', async () => {
    await expect(
      extractStudioAgentDocument({
        fileName: 'script.pdf',
        declaredMediaType: 'application/pdf',
        bytes: Buffer.from('This is plain text, not a PDF.', 'utf8'),
      }),
    ).rejects.toMatchObject({
      response: { code: 'STUDIO_AGENT_DOCUMENT_MIME_MISMATCH' },
    });
  });

  it('rejects oversized input before parsing', async () => {
    await expect(
      extractStudioAgentDocument({
        fileName: 'large.txt',
        declaredMediaType: 'text/plain',
        bytes: Buffer.alloc(STUDIO_AGENT_DOCUMENT_MAX_BYTES + 1, 0x61),
      }),
    ).rejects.toMatchObject({
      response: { code: 'STUDIO_AGENT_DOCUMENT_FILE_TOO_LARGE' },
    });
  });

  it('rejects DOCX XML with entity declarations', async () => {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types />');
    zip.file(
      'word/document.xml',
      '<!DOCTYPE x [<!ENTITY payload "unsafe">]><w:document>&payload;</w:document>',
    );
    const bytes = await zip.generateAsync({ type: 'nodebuffer' });

    await expect(
      extractStudioAgentDocument({
        fileName: 'unsafe.docx',
        declaredMediaType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        bytes,
      }),
    ).rejects.toMatchObject({
      response: { code: 'STUDIO_AGENT_DOCUMENT_ARCHIVE_UNSAFE' },
    });
  });

  it('extracts nested DOCX runs and XML entities as raw text', async () => {
    const bytes = await docx(`
      <w:p>
        <w:r><w:rPr><w:b/></w:rPr><w:t>Characters &amp; conflict</w:t></w:r>
        <w:hyperlink w:anchor="beat">
          <w:r><w:t xml:space="preserve"> &lt;beat&gt;</w:t></w:r>
        </w:hyperlink>
      </w:p>`);

    await expect(
      extractStudioAgentDocument({
        fileName: 'nested.docx',
        declaredMediaType: DOCX_MEDIA_TYPE,
        bytes,
      }),
    ).resolves.toMatchObject({
      mediaType: DOCX_MEDIA_TYPE,
      text: 'Characters & conflict <beat>',
      charCount: 28,
    });
  });

  it('ignores embedded image bytes when extracting DOCX raw text', async () => {
    const imageBytes = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const bytes = await docx(
      `
        <w:p><w:r><w:t>Before image.</w:t></w:r></w:p>
        <w:p>
          <w:r>
            <w:drawing>
              <wp:inline>
                <a:graphic>
                  <a:graphicData>
                    <pic:pic>
                      <pic:blipFill><a:blip r:embed="rIdImage"/></pic:blipFill>
                    </pic:pic>
                  </a:graphicData>
                </a:graphic>
              </wp:inline>
            </w:drawing>
          </w:r>
        </w:p>
        <w:p><w:r><w:t>After image.</w:t></w:r></w:p>`,
      { relationshipId: 'rIdImage', bytes: imageBytes },
    );

    const projection = await extractStudioAgentDocument({
      fileName: 'image.docx',
      declaredMediaType: DOCX_MEDIA_TYPE,
      bytes,
    });

    expect(projection.text).toBe('Before image.\n\n\n\nAfter image.');
    expect(projection.text).not.toContain(imageBytes.toString('base64'));
  });

  it('surfaces malformed PDF parsing failures', async () => {
    await expect(
      extractStudioAgentDocument({
        fileName: 'broken.pdf',
        declaredMediaType: 'application/pdf',
        bytes: Buffer.from('%PDF-not-a-real-document', 'ascii'),
      }),
    ).rejects.toMatchObject({
      response: { code: 'STUDIO_AGENT_DOCUMENT_PARSE_FAILED' },
    });
  });
});
