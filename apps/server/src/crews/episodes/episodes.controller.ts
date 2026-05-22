/**
 *   GET    /aurora/crews/:crewId/episodes        List  (members + finance)
 *   POST   /aurora/crews/:crewId/episodes        Create (admin)
 *   POST   /aurora/episodes/:episodeId/approve   Approve (admin)
 *
 * Assignment endpoints live in AssignmentsController for URL clarity
 * (`/aurora/episodes/:id/assignments`, `/aurora/assignments/:id/...`).
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../../auth';
import type { AuthUser } from '../../auth';
import { parseIdParam } from '../../common/params';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { CreateEpisodeSchema, type CreateEpisodeInput } from './dto';
import { EpisodesService } from './episodes.service';

function actorName(user: AuthUser): string {
  return user.nickName || user.userName || user.userId;
}

@Controller()
export class EpisodesController {
  constructor(private readonly svc: EpisodesService) {}

  @Get('crews/:crewId/episodes')
  list(@Param('crewId') crewIdRaw: string, @CurrentUser() user: AuthUser) {
    return this.svc.list(parseIdParam(crewIdRaw, 'crewId'), user.userId);
  }

  @Post('crews/:crewId/episodes')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('crewId') crewIdRaw: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateEpisodeSchema)) body: CreateEpisodeInput,
  ) {
    return this.svc.create(
      parseIdParam(crewIdRaw, 'crewId'),
      user.userId,
      actorName(user),
      body,
    );
  }

  @Post('episodes/:episodeId/approve')
  @HttpCode(HttpStatus.OK)
  approve(@Param('episodeId') idRaw: string, @CurrentUser() user: AuthUser) {
    return this.svc.approve(
      parseIdParam(idRaw, 'episodeId'),
      user.userId,
      actorName(user),
    );
  }
}
