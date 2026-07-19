/**
 * Minimal ambient types for `mammoth` (ships no declarations; the old
 * `@types/mammoth` stub is unpublished). Only the surface we use.
 */
declare module 'mammoth' {
  export interface MammothMessage {
    type: 'warning' | 'error';
    message: string;
  }

  export interface MammothResult {
    value: string;
    messages: MammothMessage[];
  }

  export interface MammothInput {
    buffer: Buffer;
  }

  export function extractRawText(input: MammothInput): Promise<MammothResult>;
  export function convertToHtml(input: MammothInput): Promise<MammothResult>;

  const mammoth: {
    extractRawText: typeof extractRawText;
    convertToHtml: typeof convertToHtml;
  };
  export default mammoth;
}
