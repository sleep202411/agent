import { convertToHtml } from 'mammoth';

/**
 * Extract readable DOCX text while preserving block and soft-line-break
 * boundaries. `extractRawText` drops `<w:br/>`, which can flatten screenplay
 * dialogue and action authored with soft returns.
 */
export async function extractDocxPlainText(buffer: Buffer): Promise<string> {
  const html = (await convertToHtml({ buffer })).value;
  return html
    .replace(/<\/(?:p|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<\/(?:td|th)>/gi, '\t')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}
