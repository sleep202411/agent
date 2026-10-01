import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../infra/db/db.module';
import {
  ContentGpsSourcesService,
  gpsSnapshotFingerprint,
} from './content-gps-sources';
const ipId = '01900000-0000-7000-8000-000000000001';
const row = {
  id: 'public-description',
  updatedAt: new Date('2026-10-01T00:00:00Z'),
  summary: ' Singapore ',
  description: null,
};
function setup(result: unknown) {
  const findFirst = jest
    .fn<Promise<unknown>, [unknown]>()
    .mockResolvedValue(result);
  const transaction = jest.fn<
    Promise<unknown>,
    [(tx: { ip: { findFirst: typeof findFirst } }) => Promise<unknown>, unknown]
  >((callback) => callback({ ip: { findFirst } }));
  const service = new ContentGpsSourcesService({
    $transaction: transaction,
  } as unknown as PrismaService);
  return { service, findFirst, transaction };
}
describe('GPS published public source snapshots', () => {
  it('requires public publication at IP, localization and episode boundaries', async () => {
    const { service, findFirst, transaction } = setup({
      localizations: [row],
      episodes: [],
    });
    const snapshot = await service.snapshot(ipId, 'en-US', 'v1');
    const query = findFirst.mock.calls[0][0];
    expect(query).toMatchObject({
      where: {
        id: ipId,
        status: 'published',
        listingVisibility: 'public',
        deletedAt: null,
        localizations: {
          some: { status: 'published', archivedAt: null, locale: 'en-US' },
        },
      },
      select: {
        episodes: {
          where: { status: 'published', deletedAt: null },
          select: {
            localizations: {
              where: { status: 'published', archivedAt: null, locale: 'en-US' },
            },
          },
        },
      },
    });
    expect(transaction.mock.calls[0][1]).toEqual({
      isolationLevel: 'RepeatableRead',
    });
    expect(snapshot.sources[0]).toMatchObject({
      text: ' Singapore ',
      locator: 'summary',
      visibilityAtAnalysis: 'public',
      sourceVersion: row.updatedAt.toISOString(),
    });
  });
  it('rejects unavailable sources rather than falling back to private or draft content', async () => {
    await expect(
      setup(null).service.snapshot(ipId, 'en-US', 'v1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
  it('includes episode descriptions with distinct field identity and skips empty text', async () => {
    const { service } = setup({
      localizations: [{ ...row, summary: ' ' }],
      episodes: [
        {
          localizations: [
            { ...row, id: 'episode', description: 'A story in 1990.' },
          ],
        },
      ],
    });
    const snapshot = await service.snapshot(ipId, 'en-US', 'v1');
    expect(snapshot.sources.map((source) => source.id)).toEqual([
      'episode:description',
      'episode:summary',
    ]);
    expect(
      snapshot.sources.every(
        (source) => source.sourceType === 'episode_localization',
      ),
    ).toBe(true);
  });
  it('rejects oversized source text instead of truncating it', async () => {
    const { service } = setup({
      localizations: [{ ...row, description: 'x'.repeat(20001) }],
      episodes: [],
    });
    await expect(service.snapshot(ipId, 'en-US', 'v1')).rejects.toThrow();
  });
  it('fingerprints exact source text and versions while ignoring attempt timestamps', async () => {
    const { service } = setup({ localizations: [row], episodes: [] });
    const snapshot = await service.snapshot(ipId, 'en-US', 'v1');
    const fingerprint = gpsSnapshotFingerprint(snapshot);
    expect(
      gpsSnapshotFingerprint({
        ...snapshot,
        analyzedAt: '2026-10-02T00:00:00Z',
      }),
    ).toBe(fingerprint);
    expect(
      gpsSnapshotFingerprint({
        ...snapshot,
        sources: snapshot.sources.map((source) => ({
          ...source,
          text: 'Singapore',
        })),
      }),
    ).not.toBe(fingerprint);
    expect(
      gpsSnapshotFingerprint({
        ...snapshot,
        sources: snapshot.sources.map((source) => ({
          ...source,
          sourceVersion: 'new-version',
        })),
      }),
    ).not.toBe(fingerprint);
  });
});
