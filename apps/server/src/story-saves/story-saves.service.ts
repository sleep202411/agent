import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import type { SaveBody } from './story-saves.dto';

/** Hard cap on the serialized save payload — engine state is manifest-bounded
 *  (watched/unlocked ids are deduped), so real saves sit far below this. */
const MAX_SAVE_BYTES = 128 * 1024;

export interface StorySaveDto {
  gameId: string;
  chapterId: string;
  contentVersion: string;
  state: unknown;
  events: unknown;
  updatedAt: string;
}

/**
 * Interactive-film play saves (存档). One "current run" slot per
 * (user, game, chapter); `latest` backs the Steam-style "continue where you
 * last played" pointer. Saves are never version-gated here — the web layer
 * validates a save against the live manifest on restore and deletes it only
 * when it no longer fits.
 */
@Injectable()
export class StorySavesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Most recently updated save across the game's chapters, or null. */
  async latest(userId: string, gameId: string): Promise<StorySaveDto | null> {
    const row = await this.prisma.storyPlaySave.findFirst({
      where: { userId, gameId },
      orderBy: { updatedAt: 'desc' },
    });
    return row ? toDto(row) : null;
  }

  async chapter(
    userId: string,
    gameId: string,
    chapterId: string,
  ): Promise<StorySaveDto | null> {
    const row = await this.prisma.storyPlaySave.findUnique({
      where: { userId_gameId_chapterId: { userId, gameId, chapterId } },
    });
    return row ? toDto(row) : null;
  }

  async save(
    userId: string,
    gameId: string,
    chapterId: string,
    body: SaveBody,
  ): Promise<{ saved: true; updatedAt: string }> {
    const size = Buffer.byteLength(
      JSON.stringify({ state: body.state, events: body.events }),
    );
    if (size > MAX_SAVE_BYTES) {
      throw new BadRequestException(
        `Save payload too large (${size} bytes, limit ${MAX_SAVE_BYTES}).`,
      );
    }
    const row = await this.prisma.storyPlaySave.upsert({
      where: {
        userId_gameId_chapterId: {
          userId,
          gameId,
          chapterId,
        },
      },
      create: {
        userId,
        gameId,
        chapterId,
        contentVersion: body.contentVersion,
        state: body.state as Prisma.InputJsonObject,
        events: body.events as Prisma.InputJsonValue,
      },
      update: {
        contentVersion: body.contentVersion,
        state: body.state as Prisma.InputJsonObject,
        events: body.events as Prisma.InputJsonValue,
      },
    });
    return { saved: true as const, updatedAt: row.updatedAt.toISOString() };
  }

  /** Idempotent clear — restarting a run drops the slot before replay. */
  async clear(
    userId: string,
    gameId: string,
    chapterId: string,
  ): Promise<{ cleared: true }> {
    await this.prisma.storyPlaySave.deleteMany({
      where: { userId, gameId, chapterId },
    });
    return { cleared: true as const };
  }
}

function toDto(row: {
  gameId: string;
  chapterId: string;
  contentVersion: string;
  state: unknown;
  events: unknown;
  updatedAt: Date;
}): StorySaveDto {
  return {
    gameId: row.gameId,
    chapterId: row.chapterId,
    contentVersion: row.contentVersion,
    state: row.state,
    events: row.events,
    updatedAt: row.updatedAt.toISOString(),
  };
}
