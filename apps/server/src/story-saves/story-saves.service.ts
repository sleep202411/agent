import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import type { SaveBody } from './story-saves.dto';
import {
  EXPERIENCE_JOURNEY_MAX_ANCHORS,
  EXPERIENCE_JOURNEY_MAX_BYTES,
  ExperienceJourneyAnchorSchema,
  ExperienceJourneyDeltaSchema,
  ExperienceJourneyMetadataSchema,
  ExperienceJourneySchema,
  type ExperienceJourney,
  type ExperienceJourneyDelta,
  type ExperienceJourneyEdge,
  type ExperienceJourneyMetadata,
} from '@repo/shared/experience-runtime';

const MAX_SAVE_BYTES = 128 * 1024;

export interface StorySaveDto {
  gameId: string;
  chapterId: string;
  contentVersion: string;
  state: unknown;
  events: unknown;
  playback: unknown;
  revision: number;
  updatedAt: string;
  /** Full history on chapter reads only; latest remains a lightweight pointer. */
  journey?: ExperienceJourney | null;
}

export interface StorySaveSlotDto {
  save: StorySaveDto | null;
  /** Retained even when the slot was cleared. */
  revision: number;
}

type SaveContent = Pick<
  Prisma.StoryPlaySaveCreateInput,
  'contentVersion' | 'state' | 'events' | 'playback' | 'cleared' | 'journey'
>;

/** One revisioned current-run slot per authenticated user, game and chapter. */
@Injectable()
export class StorySavesService {
  constructor(private readonly prisma: PrismaService) {}

  async latest(userId: string, gameId: string): Promise<StorySaveDto | null> {
    const row = await this.prisma.storyPlaySave.findFirst({
      where: { userId, gameId, cleared: false },
      orderBy: { updatedAt: 'desc' },
      // The Continue lookup must not load the potentially large graph history.
      select: {
        gameId: true,
        chapterId: true,
        contentVersion: true,
        state: true,
        events: true,
        playback: true,
        revision: true,
        updatedAt: true,
      },
    });
    return row ? toDto(row) : null;
  }

  async chapter(
    userId: string,
    gameId: string,
    chapterId: string,
  ): Promise<StorySaveSlotDto> {
    // The parent and its anchors are read from one snapshot. A concurrent
    // revision must not pair old engine state with newer rewind checkpoints.
    return this.prisma.$transaction(
      async (tx) => {
        const where = { userId, gameId, chapterId };
        const row = await tx.storyPlaySave.findUnique({
          where: { userId_gameId_chapterId: where },
        });
        if (!row || row.cleared)
          return { save: null, revision: row?.revision ?? 0 };
        let journey: ExperienceJourney | null = null;
        if (row.journey != null) {
          const metadata = storedMetadata(row.journey);
          const records = await tx.storyPlaySaveAnchor.findMany({
            where,
            select: { sceneId: true, anchor: true },
          });
          const anchors = new Map(
            records.map((record) => {
              const parsed = ExperienceJourneyAnchorSchema.safeParse(
                record.anchor,
              );
              if (
                !parsed.success ||
                parsed.data.sceneId !== record.sceneId ||
                !metadata.visitedNodeIds.includes(record.sceneId)
              )
                throw invalidJourney();
              return [record.sceneId, parsed.data] as const;
            }),
          );
          const parsed = ExperienceJourneySchema.safeParse({
            ...metadata,
            // Entry order follows first visits, independent of database row order.
            anchors: metadata.visitedNodeIds.flatMap((id) =>
              anchors.has(id) ? [anchors.get(id)!] : [],
            ),
          });
          if (!parsed.success) throw invalidJourney();
          journey = parsed.data;
        }
        return { save: { ...toDto(row), journey }, revision: row.revision };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async save(
    userId: string,
    gameId: string,
    chapterId: string,
    body: SaveBody,
  ): Promise<{ saved: true; updatedAt: string; revision: number }> {
    const { journeyDelta, ...checkpoint } = body;
    // Historical snapshots have their own bounded incremental contract. They
    // do not reduce the existing engine/media checkpoint's 128 KiB budget.
    const size = Buffer.byteLength(JSON.stringify(checkpoint));
    const delta =
      journeyDelta === undefined ? undefined : parseDelta(journeyDelta);
    if (size > MAX_SAVE_BYTES) {
      throw new BadRequestException(
        `Save payload too large (${size} bytes, limit ${MAX_SAVE_BYTES}).`,
      );
    }
    const row = await this.writeRevision(
      userId,
      gameId,
      chapterId,
      body.expectedRevision,
      {
        contentVersion: body.contentVersion,
        state: body.state as Prisma.InputJsonObject,
        events: body.events as Prisma.InputJsonValue,
        playback:
          body.playback == null
            ? Prisma.DbNull
            : (body.playback as Prisma.InputJsonObject),
        cleared: false,
      },
      delta,
    );
    return {
      saved: true,
      updatedAt: row.updatedAt.toISOString(),
      revision: row.revision,
    };
  }

  async clear(
    userId: string,
    gameId: string,
    chapterId: string,
    expectedRevision: number,
  ): Promise<{ cleared: true; revision: number }> {
    const row = await this.writeRevision(
      userId,
      gameId,
      chapterId,
      expectedRevision,
      {
        contentVersion: '',
        state: {},
        events: [],
        playback: Prisma.DbNull,
        cleared: true,
        journey: Prisma.DbNull,
      },
    );
    return { cleared: true, revision: row.revision };
  }

  private async writeRevision(
    userId: string,
    gameId: string,
    chapterId: string,
    expectedRevision: number,
    content: SaveContent,
    delta?: ExperienceJourneyDelta,
  ): Promise<{ revision: number; updatedAt: Date }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const address = { userId, gameId, chapterId };
        const select = {
          revision: true,
          updatedAt: true,
          journey: true,
        } as const;
        // CAS acquires the parent row lock before any history mutation. The
        // lock is held through metadata merge and normalized anchor upserts.
        const updated = await tx.storyPlaySave.updateManyAndReturn({
          where: { ...address, revision: expectedRevision },
          data: { ...content, revision: { increment: 1 } },
          select,
        });
        let row = updated[0];
        if (!row) {
          if (expectedRevision !== 0) throw saveConflict();
          row = await tx.storyPlaySave.create({
            data: { ...address, ...content, revision: 1 },
            select,
          });
        }
        if (content.cleared) {
          await tx.storyPlaySaveAnchor.deleteMany({ where: address });
        } else if (delta) {
          const previous =
            row.journey == null ? null : storedMetadata(row.journey);
          const reset = previous?.signature !== delta.signature;
          const metadata = mergeMetadata(reset ? null : previous, delta);
          if (reset)
            await tx.storyPlaySaveAnchor.deleteMany({ where: address });
          const seen = new Set<string>();
          for (const anchor of delta.anchors) {
            if (
              seen.has(anchor.sceneId) ||
              !metadata.visitedNodeIds.includes(anchor.sceneId)
            ) {
              throw new BadRequestException(
                'Journey anchors must name distinct visited scenes.',
              );
            }
            seen.add(anchor.sceneId);
            const data = {
              anchor: anchor as Prisma.InputJsonObject,
              sizeBytes: jsonBytes(anchor),
            };
            await tx.storyPlaySaveAnchor.upsert({
              where: {
                userId_gameId_chapterId_sceneId: {
                  ...address,
                  sceneId: anchor.sceneId,
                },
              },
              create: { ...address, sceneId: anchor.sceneId, ...data },
              update: data,
            });
          }
          const usage = await tx.storyPlaySaveAnchor.aggregate({
            where: address,
            _count: true,
            _sum: { sizeBytes: true },
          });
          if (
            usage._count > EXPERIENCE_JOURNEY_MAX_ANCHORS ||
            (usage._sum.sizeBytes ?? 0) +
              jsonBytes({ ...metadata, anchors: [] }) +
              Math.max(0, usage._count - 1) >
              EXPERIENCE_JOURNEY_MAX_BYTES
          ) {
            throw new BadRequestException('Journey exceeds its data limit.');
          }
          await tx.storyPlaySave.update({
            where: { userId_gameId_chapterId: address },
            data: {
              journey: metadata as Prisma.InputJsonObject,
              updatedAt: row.updatedAt,
            },
          });
        }
        return { revision: row.revision, updatedAt: row.updatedAt };
      });
    } catch (error) {
      // A concurrent first create is the only unique key race. Throw after
      // the transaction rolls back, so a failed CAS cannot leave any anchors.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw saveConflict();
      }
      throw error;
    }
  }
}

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function parseDelta(value: unknown): ExperienceJourneyDelta {
  const parsed = ExperienceJourneyDeltaSchema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException(
      `Invalid journey update: ${parsed.error.issues[0]?.message ?? 'invalid payload'}`,
    );
  }
  return parsed.data;
}

function storedMetadata(value: unknown): ExperienceJourneyMetadata {
  const parsed = ExperienceJourneyMetadataSchema.safeParse(value);
  if (!parsed.success) throw invalidJourney();
  return parsed.data;
}

function invalidJourney(): ServiceUnavailableException {
  return new ServiceUnavailableException('Saved journey data is invalid.');
}

function edgeIdentity(edge: ExperienceJourneyEdge): string {
  return JSON.stringify([
    edge.fromSceneId,
    edge.bindingId,
    edge.routeId,
    'toSceneId' in edge ? 'scene' : 'ending',
    'toSceneId' in edge ? edge.toSceneId : edge.toEndingId,
  ]);
}

function mergeMetadata(
  previous: ExperienceJourneyMetadata | null,
  delta: ExperienceJourneyDelta,
): ExperienceJourneyMetadata {
  const edges = new Map<string, ExperienceJourneyEdge>();
  for (const edge of [
    ...(previous?.traversedEdges ?? []),
    ...delta.addedTraversedEdges,
  ]) {
    edges.set(edgeIdentity(edge), edge);
  }
  const paths = new Map<
    string,
    ExperienceJourneyMetadata['traversedPaths'][number]
  >();
  for (const path of [
    ...(previous?.traversedPaths ?? []),
    ...delta.addedTraversedPaths,
  ]) {
    paths.set(JSON.stringify(path.map(edgeIdentity)), path);
  }
  const watched = new Map<
    string,
    ExperienceJourneyMetadata['watchedMedia'][number]
  >();
  for (const media of [
    ...(previous?.watchedMedia ?? []),
    ...delta.addedWatchedMedia,
  ]) {
    const key = JSON.stringify([
      media.sceneId,
      media.rendererInstanceId,
      media.sequenceIndex,
      media.assetId,
      media.mediaSignature,
    ]);
    const existing = watched.get(key);
    if (!existing || media.watchedUntilMs > existing.watchedUntilMs)
      watched.set(key, media);
  }
  const parsed = ExperienceJourneyMetadataSchema.safeParse({
    version: 1,
    signature: delta.signature,
    visitedNodeIds: [
      ...new Set([
        ...(previous?.visitedNodeIds ?? []),
        ...delta.addedVisitedNodeIds,
      ]),
    ],
    traversedEdges: [...edges.values()],
    traversedPaths: [...paths.values()],
    watchedMedia: [...watched.values()],
    activeAccessRefs:
      delta.activeAccessRefs ?? previous?.activeAccessRefs ?? [],
  });
  if (!parsed.success)
    throw new BadRequestException('Journey exceeds its data limit.');
  return parsed.data;
}

function saveConflict(): ConflictException {
  return new ConflictException(
    'Save has changed. Reload the latest save before trying again.',
  );
}

function toDto(row: {
  gameId: string;
  chapterId: string;
  contentVersion: string;
  state: unknown;
  events: unknown;
  playback: unknown;
  revision: number;
  updatedAt: Date;
}): StorySaveDto {
  return {
    gameId: row.gameId,
    chapterId: row.chapterId,
    contentVersion: row.contentVersion,
    state: row.state,
    events: row.events,
    playback: row.playback,
    revision: row.revision,
    updatedAt: row.updatedAt.toISOString(),
  };
}
