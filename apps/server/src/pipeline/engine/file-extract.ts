import { Logger } from '@nestjs/common';

const logger = new Logger('FileExtract');

/**
 * Download a file from a URL and extract its text content.
 * Supports: PDF, DOCX, TXT.
 */
export async function extractTextFromUrl(
  fileUrl: string,
  mimeType?: string,
): Promise<string> {
  logger.log(`Downloading file: ${fileUrl.slice(0, 100)}... (${mimeType})`);

  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`Failed to download file: HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  logger.log(`Downloaded ${buffer.length} bytes`);

  const ext = guessExtension(fileUrl, mimeType);

  if (ext === 'pdf') {
    return extractPdfText(buffer);
  }
  if (ext === 'docx') {
    return extractDocxText(buffer);
  }
  // Default: treat as plain text
  return buffer.toString('utf-8').trim();
}

function guessExtension(url: string, mimeType?: string): string {
  if (mimeType === 'application/pdf') return 'pdf';
  if (
    mimeType ===
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
    return 'docx';
  if (mimeType?.startsWith('text/')) return 'txt';

  const path = url.split('?')[0].toLowerCase();
  if (path.endsWith('.pdf')) return 'pdf';
  if (path.endsWith('.docx')) return 'docx';
  if (path.endsWith('.doc')) return 'docx';
  if (path.endsWith('.txt') || path.endsWith('.md')) return 'txt';

  return 'txt';
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  logger.log(`Extracting PDF text (${buffer.length} bytes)`);
  // pdf-parse v1 — default export is a function
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require('pdf-parse');
  const parse = (
    typeof pdfParse === 'function' ? pdfParse : pdfParse.default
  ) as (buffer: Buffer) => Promise<{ numpages: number; text: string }>;
  const result = await parse(buffer);
  logger.log(
    `PDF extracted: ${result.numpages} pages, ${result.text.length} chars`,
  );
  return result.text.trim();
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  logger.log(`Extracting DOCX text (${buffer.length} bytes)`);
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  logger.log(`DOCX extracted: ${result.value.length} chars`);
  return result.value.trim();
}
