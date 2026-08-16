import { ossSignedReadQueries } from './oss-storage.service';

describe('ossSignedReadQueries', () => {
  it('never overrides Content-Type — CN OSS CNAME rejects it with 400', () => {
    expect(
      ossSignedReadQueries({
        bucket: 'fizzdragon-ai-outputs',
        storageKey: 'clip.mp4',
        contentType: 'video/mp4',
        cacheControl: 'private, no-store',
        filename: 'clip.mp4',
      }),
    ).toEqual({
      queries: {
        'response-cache-control': 'private, no-store',
        'response-content-disposition': 'inline; filename="clip.mp4"',
      },
    });
  });

  it('omits the query block when there is nothing legal to override', () => {
    expect(
      ossSignedReadQueries({
        bucket: 'fizzdragon-ai-outputs',
        storageKey: 'clip.mp4',
        contentType: 'video/mp4',
      }),
    ).toBeUndefined();
  });
});
