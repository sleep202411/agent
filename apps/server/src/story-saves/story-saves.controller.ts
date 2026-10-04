import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import type { z } from 'zod';
import { CurrentUser, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  ClearSaveQuerySchema,
  SaveBodySchema,
  SaveSlotQuerySchema,
} from './story-saves.dto';
import { StorySavesService } from './story-saves.service';

/**
 * /aurora/story-saves — interactive-film play saves (存档). All routes are
 * authenticated and scoped to the CURRENT user. The slot is addressed by
 * gameId + `?chapterId=` (omitted for single-chapter works).
 */
@Controller('story-saves')
export class StorySavesController {
  constructor(private readonly saves: StorySavesService) {}

  /** "Continue playing" pointer: the chapter the user last played. */
  @Get(':gameId/latest')
  @Header('Cache-Control', 'private, no-store')
  async latest(@CurrentUser() user: AuthUser, @Param('gameId') gameId: string) {
    return { code: 200, data: await this.saves.latest(user.userId, gameId) };
  }

  @Get(':gameId/save')
  @Header('Cache-Control', 'private, no-store')
  async chapter(
    @CurrentUser() user: AuthUser,
    @Param('gameId') gameId: string,
    @Query(new ZodValidationPipe(SaveSlotQuerySchema))
    query: z.infer<typeof SaveSlotQuerySchema>,
  ) {
    return {
      code: 200,
      data: await this.saves.chapter(user.userId, gameId, query.chapterId),
    };
  }

  @Put(':gameId/save')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async save(
    @CurrentUser() user: AuthUser,
    @Param('gameId') gameId: string,
    @Query(new ZodValidationPipe(SaveSlotQuerySchema))
    query: z.infer<typeof SaveSlotQuerySchema>,
    @Body(new ZodValidationPipe(SaveBodySchema))
    body: z.infer<typeof SaveBodySchema>,
  ) {
    return {
      code: 200,
      data: await this.saves.save(user.userId, gameId, query.chapterId, body),
    };
  }

  @Delete(':gameId/save')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async clear(
    @CurrentUser() user: AuthUser,
    @Param('gameId') gameId: string,
    @Query(new ZodValidationPipe(ClearSaveQuerySchema))
    query: z.infer<typeof ClearSaveQuerySchema>,
  ) {
    return {
      code: 200,
      data: await this.saves.clear(
        user.userId,
        gameId,
        query.chapterId,
        query.expectedRevision,
      ),
    };
  }
}
