import {
  revenueContractFileType,
  REVENUE_CONTRACT_MAX_BYTES,
} from './revenue-contract-file';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0d8AAAAASUVORK5CYII=',
  'base64',
);
it('derives supported media type from bytes and rejects truncated containers', () => {
  expect(
    revenueContractFileType(Buffer.from('%PDF-1.7\nfixture\n%%EOF')),
  ).toEqual({ contentType: 'application/pdf', extension: 'pdf' });
  expect(revenueContractFileType(png)).toEqual({
    contentType: 'image/png',
    extension: 'png',
  });
  expect(
    revenueContractFileType(Buffer.from([255, 216, 255, 224, 0, 2, 255, 217])),
  ).toEqual({ contentType: 'image/jpeg', extension: 'jpg' });
  for (const bad of [
    undefined,
    Buffer.alloc(0),
    Buffer.from('<svg></svg>'),
    png.subarray(0, -1),
    Buffer.from([255, 216, 255, 224]),
    Buffer.from('%PDF-1.7\ntruncated'),
  ])
    expect(() => revenueContractFileType(bad)).toThrow('PDF, JPG or PNG');
});
it('enforces the ten-megabyte per-file limit before storage access', () => {
  const bytes = Buffer.alloc(REVENUE_CONTRACT_MAX_BYTES);
  bytes.write('%PDF-1.7');
  bytes.write('%%EOF', bytes.length - 5);
  expect(revenueContractFileType(bytes).contentType).toBe('application/pdf');
  expect(() =>
    revenueContractFileType(Buffer.concat([bytes, Buffer.from('x')])),
  ).toThrow('10 MB');
});
