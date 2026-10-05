import { BadRequestException } from '@nestjs/common';

export const REVENUE_CONTRACT_MAX_BYTES = 10 * 1024 * 1024;
/** Detect the supported container from bytes; never trust an extension or browser MIME. */
export function revenueContractFileType(bytes: Buffer | undefined) {
  if (bytes?.length && bytes.length <= REVENUE_CONTRACT_MAX_BYTES) {
    if (
      bytes.subarray(0, 5).toString('ascii') === '%PDF-' &&
      bytes.subarray(-1024).includes(Buffer.from('%%EOF'))
    )
      return { contentType: 'application/pdf', extension: 'pdf' } as const;
    if (
      bytes.length >= 45 &&
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      bytes.readUInt32BE(8) === 13 &&
      bytes.subarray(12, 16).toString('ascii') === 'IHDR' &&
      bytes.readUInt32BE(16) > 0 &&
      bytes.readUInt32BE(20) > 0 &&
      bytes
        .subarray(-12)
        .equals(Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]))
    )
      return { contentType: 'image/png', extension: 'png' } as const;
    if (
      bytes.length >= 8 &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes[2] === 255 &&
      bytes.at(-2) === 255 &&
      bytes.at(-1) === 217
    )
      return { contentType: 'image/jpeg', extension: 'jpg' } as const;
  }
  throw new BadRequestException(
    'Upload a PDF, JPG or PNG contract up to 10 MB.',
  );
}
