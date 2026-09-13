import { ReleaseLinksSchema } from './ip-release-links';
it.each([
  'javascript:alert(1)',
  'http://example.com',
  'https://user:pass@example.com',
  'not a URL',
])('rejects unsupported release link %s', (url) => {
  expect(
    ReleaseLinksSchema.safeParse([{ label: 'Platform', url }]).success,
  ).toBe(false);
});
it('accepts named HTTPS releases and rejects duplicate links', () => {
  const item = { label: 'Platform', url: 'https://example.com/title' };
  expect(ReleaseLinksSchema.parse([item])).toEqual([item]);
  expect(ReleaseLinksSchema.safeParse([item, item]).success).toBe(false);
});
