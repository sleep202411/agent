import { createHash } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ContentGpsExtractionRequestSchema,
  type ContentGpsExtractionRequest,
} from '@repo/shared/content-gps';
import { PrismaService } from '../infra/db/db.module';

type PublicText = {
  id: string;
  updatedAt: Date;
  summary: string | null;
  description: string | null;
};

// Deliberately narrower than some catalogue fallbacks: the approved initial
// analysis scope is published public text, not approved-but-unpublished drafts.
const publicLocalization = { status: 'published' as const, archivedAt: null };
const textSelect = {
  id: true,
  updatedAt: true,
  summary: true,
  description: true,
} as const;

export function gpsSnapshotFingerprint(request: ContentGpsExtractionRequest) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        ipId: request.ipId,
        sources: [...request.sources].sort((a, b) =>
          a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
        ),
      }),
    )
    .digest('hex');
}

@Injectable()
export class ContentGpsSourcesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Internal snapshot only: never a public serializer or permission authority.
   * No source text is fetched from URLs and no model is called here. */
  async snapshot(
    ipId: string,
    locale: ContentGpsExtractionRequest['locale'],
    analysisVersion: string,
  ) {
    return this.prisma.$transaction(
      (tx) => this.snapshotIn(tx, ipId, locale, analysisVersion),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async snapshotIn(
    tx: Prisma.TransactionClient,
    ipId: string,
    locale: ContentGpsExtractionRequest['locale'],
    analysisVersion: string,
  ) {
    const ip = await tx.ip.findFirst({
      where: {
        id: ipId,
        status: 'published',
        listingVisibility: 'public',
        deletedAt: null,
        localizations: { some: { ...publicLocalization, locale } },
      },
      select: {
        id: true,
        localizations: {
          where: { ...publicLocalization, locale },
          select: textSelect,
        },
        episodes: {
          where: { status: 'published', deletedAt: null },
          select: {
            localizations: {
              where: { ...publicLocalization, locale },
              select: textSelect,
            },
          },
        },
      },
    });
    if (!ip) throw new NotFoundException('Published public IP not found.');
    const sources: ContentGpsExtractionRequest['sources'] = [];
    const append = (
      rows: PublicText[],
      sourceType: 'ip_localization' | 'episode_localization',
    ) => {
      for (const row of rows)
        for (const field of ['summary', 'description'] as const) {
          const text = row[field];
          if (!text?.trim()) continue;
          // Keep exact text, including whitespace, for UTF-16 citation offsets.
          sources.push({
            id: `${row.id}:${field}`,
            sourceType,
            sourceId: row.id,
            sourceVersion: row.updatedAt.toISOString(),
            locator: field,
            visibilityAtAnalysis: 'public',
            text,
          });
        }
    };
    append(ip.localizations, 'ip_localization');
    for (const episode of ip.episodes)
      append(episode.localizations, 'episode_localization');
    sources.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    // Refuse oversized snapshots instead of silently analyzing partial IPs.
    return ContentGpsExtractionRequestSchema.parse({
      ipId,
      locale,
      analysisVersion,
      analyzedAt: new Date().toISOString(),
      sources,
    });
  }
}
