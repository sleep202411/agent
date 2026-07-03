/**
 * Character library HTTP surface — `/aurora/characters` (workspace 演员池)
 * and `/aurora/projects/:projectId/cast` (project 演员表). Route shapes are
 * the verbatim server side of `apps/studio/lib/characters-api.ts`; the
 * global AuthGuard supplies identity, authorization lives in the service
 * (workspace roles for the library, project roles for the cast).
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../auth';
import type { AuthUser } from '../auth';
import { CharacterCastingService } from './character-casting.service';
import { CharacterEnrollmentService } from './character-enrollment.service';
import { CharacterGrantService } from './character-grant.service';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  AttachCharacterMediaSchema,
  CastCharacterSchema,
  CharacterIdParamsSchema,
  CharacterMediaParamsSchema,
  AcceptCastingInviteSchema,
  CastingInviteMemberParamsSchema,
  CastingInviteProjectParamsSchema,
  CastingInviteTokenParamsSchema,
  CreateCastingInviteSchema,
  CreateCharacterSchema,
  GrantProjectParamsSchema,
  GrantProjectSchema,
  LikenessOutputsQuerySchema,
  LikenessTakedownSchema,
  ListCharactersQuerySchema,
  ProjectCastMemberParamsSchema,
  ProjectCastParamsSchema,
  ReorderCharacterMediaSchema,
  UpdateCharacterSchema,
  type AttachCharacterMediaInput,
  type CastCharacterInput,
  type CharacterIdParams,
  type CharacterMediaParams,
  type AcceptCastingInviteInput,
  type CastingInviteMemberParams,
  type CastingInviteProjectParams,
  type CastingInviteTokenParams,
  type CreateCastingInviteInput,
  type CreateCharacterInput,
  type GrantProjectInput,
  type GrantProjectParams,
  type LikenessOutputsQuery,
  type LikenessTakedownInput,
  type ListCharactersQuery,
  type ProjectCastMemberParams,
  type ProjectCastParams,
  type ReorderCharacterMediaInput,
  type UpdateCharacterInput,
} from './dto';
import { CharactersService } from './characters.service';

@Controller('characters')
export class CharactersController {
  constructor(
    private readonly characters: CharactersService,
    private readonly enrollment: CharacterEnrollmentService,
    private readonly grants: CharacterGrantService,
  ) {}

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateCharacterSchema))
    body: CreateCharacterInput,
    @Req() req: Request,
  ) {
    return {
      code: 200,
      // Request metadata rides into the consent_granted evidence for
      // real_person creates (design §1) — hashes/metadata only.
      data: await this.characters.create(user, body, {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        locale: req.headers['accept-language'],
      }),
    };
  }

  // ─── Real-person enrollment (design §2.1) ───

  @Post(':id/enrollment/session')
  async createEnrollmentSession(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(CharacterIdParamsSchema))
    params: CharacterIdParams,
  ) {
    return {
      code: 200,
      data: await this.enrollment.createSession(user, params.id),
    };
  }

  /** Idempotent; NO client token — completion is a server→provider pull. */
  @Post(':id/enrollment/complete')
  async completeEnrollment(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(CharacterIdParamsSchema))
    params: CharacterIdParams,
  ) {
    await this.enrollment.complete(user, params.id);
    return { code: 200, data: await this.characters.get(user, params.id) };
  }

  @Get(':id/enrollment/status')
  async enrollmentStatus(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(CharacterIdParamsSchema))
    params: CharacterIdParams,
  ) {
    return {
      code: 200,
      data: await this.enrollment.status(user, params.id),
    };
  }

  // ─── Per-project likeness authorization grants (v2 §5) ───

  /** Subject authorizes a project (self-grant; subject must be its editor). */
  @Post(':id/grants')
  async grantProject(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(CharacterIdParamsSchema))
    params: CharacterIdParams,
    @Body(new ZodValidationPipe(GrantProjectSchema)) body: GrantProjectInput,
    @Req() req: Request,
  ) {
    return {
      code: 200,
      data: await this.grants.grantProject(
        user,
        params.id,
        body.projectId,
        body.consent,
        { ip: req.ip, userAgent: req.headers['user-agent'] },
      ),
    };
  }

  @Get(':id/grants')
  async listGrants(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(CharacterIdParamsSchema))
    params: CharacterIdParams,
  ) {
    return { code: 200, data: await this.grants.listGrants(user, params.id) };
  }

  /** Subject sees every video generated from their likeness (§6). */
  @Get(':id/outputs')
  async listLikenessOutputs(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(CharacterIdParamsSchema))
    params: CharacterIdParams,
    @Query(new ZodValidationPipe(LikenessOutputsQuerySchema))
    query: LikenessOutputsQuery,
  ) {
    return {
      code: 200,
      data: await this.grants.listLikenessOutputs(
        user,
        params.id,
        query.projectId,
      ),
    };
  }

  /** Subject takes down outputs made from their likeness (§6). */
  @Post(':id/outputs/takedown')
  async takedownLikenessOutputs(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(CharacterIdParamsSchema))
    params: CharacterIdParams,
    @Body(new ZodValidationPipe(LikenessTakedownSchema))
    body: LikenessTakedownInput,
  ) {
    return {
      code: 200,
      data: await this.grants.takedownLikenessOutputs(user, params.id, body),
    };
  }

  /** Subject withdraws a project authorization (reachable even if removed). */
  @Delete(':id/grants/:projectId')
  async revokeGrant(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(GrantProjectParamsSchema))
    params: GrantProjectParams,
  ) {
    await this.grants.revokeProjectGrant(user, params.id, params.projectId);
    return { code: 200, data: { ok: true } };
  }

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListCharactersQuerySchema))
    query: ListCharactersQuery,
  ) {
    return {
      code: 200,
      data: await this.characters.list(user, query.workspaceId),
    };
  }

  @Get(':id')
  async get(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(CharacterIdParamsSchema))
    params: CharacterIdParams,
  ) {
    return { code: 200, data: await this.characters.get(user, params.id) };
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(CharacterIdParamsSchema))
    params: CharacterIdParams,
    @Body(new ZodValidationPipe(UpdateCharacterSchema))
    body: UpdateCharacterInput,
  ) {
    return {
      code: 200,
      data: await this.characters.update(user, params.id, body),
    };
  }

  @Delete(':id')
  async remove(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(CharacterIdParamsSchema))
    params: CharacterIdParams,
  ) {
    await this.characters.remove(user, params.id);
    return { code: 200, data: { removed: true } };
  }

  @Post(':id/media')
  async attachMedia(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(CharacterIdParamsSchema))
    params: CharacterIdParams,
    @Body(new ZodValidationPipe(AttachCharacterMediaSchema))
    body: AttachCharacterMediaInput,
  ) {
    return {
      code: 200,
      data: await this.characters.attachMedia(user, params.id, body),
    };
  }

  @Delete(':id/media/:mediaId')
  async removeMedia(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(CharacterMediaParamsSchema))
    params: CharacterMediaParams,
  ) {
    // Same envelope as attach/reorder: the fresh CharacterDetail, so the
    // client updates in one round-trip instead of DELETE-then-GET.
    return {
      code: 200,
      data: await this.characters.removeMedia(user, params.id, params.mediaId),
    };
  }

  @Patch(':id/media')
  async reorderMedia(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(CharacterIdParamsSchema))
    params: CharacterIdParams,
    @Body(new ZodValidationPipe(ReorderCharacterMediaSchema))
    body: ReorderCharacterMediaInput,
  ) {
    return {
      code: 200,
      data: await this.characters.reorderMedia(user, params.id, body),
    };
  }
}

@Controller('projects/:projectId/cast')
export class ProjectCastController {
  constructor(private readonly characters: CharactersService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(ProjectCastParamsSchema))
    params: ProjectCastParams,
  ) {
    return {
      code: 200,
      data: await this.characters.listCast(user, params.projectId),
    };
  }

  @Post()
  async cast(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(ProjectCastParamsSchema))
    params: ProjectCastParams,
    @Body(new ZodValidationPipe(CastCharacterSchema))
    body: CastCharacterInput,
  ) {
    return {
      code: 200,
      data: await this.characters.castCharacter(
        user,
        params.projectId,
        body.characterId,
      ),
    };
  }

  @Delete(':characterId')
  async uncast(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(ProjectCastMemberParamsSchema))
    params: ProjectCastMemberParams,
  ) {
    await this.characters.uncastCharacter(
      user,
      params.projectId,
      params.characterId,
    );
    return { code: 200, data: { removed: true } };
  }
}

/**
 * B2 casting invites (design §D-B). Director routes hang under the project;
 * actor accept/preview routes are token-gated at the top level.
 */
@Controller()
export class CharacterCastingController {
  constructor(
    private readonly casting: CharacterCastingService,
    private readonly characters: CharactersService,
  ) {}

  /** real_person likenesses granted to a project — the cast picker unions these. */
  @Get('projects/:projectId/granted-characters')
  async grantedCharacters(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(CastingInviteProjectParamsSchema))
    params: CastingInviteProjectParams,
  ) {
    return {
      code: 200,
      data: await this.characters.listGrantedCharacters(user, params.projectId),
    };
  }

  @Post('projects/:projectId/casting-invites')
  async createInvite(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(CastingInviteProjectParamsSchema))
    params: CastingInviteProjectParams,
    @Body(new ZodValidationPipe(CreateCastingInviteSchema))
    body: CreateCastingInviteInput,
  ) {
    return {
      code: 200,
      data: await this.casting.createInvite(user, params.projectId, body),
    };
  }

  @Get('projects/:projectId/casting-invites')
  async listInvites(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(CastingInviteProjectParamsSchema))
    params: CastingInviteProjectParams,
  ) {
    return {
      code: 200,
      data: await this.casting.listInvites(user, params.projectId),
    };
  }

  @Delete('projects/:projectId/casting-invites/:inviteId')
  async revokeInvite(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(CastingInviteMemberParamsSchema))
    params: CastingInviteMemberParams,
  ) {
    await this.casting.revokeInvite(user, params.projectId, params.inviteId);
    return { code: 200, data: { ok: true } };
  }

  @Get('casting-invites/:token')
  async preview(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(CastingInviteTokenParamsSchema))
    params: CastingInviteTokenParams,
  ) {
    return {
      code: 200,
      data: await this.casting.previewInvite(user, params.token),
    };
  }

  @Post('casting-invites/:token/accept')
  async accept(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(CastingInviteTokenParamsSchema))
    params: CastingInviteTokenParams,
    @Body(new ZodValidationPipe(AcceptCastingInviteSchema))
    body: AcceptCastingInviteInput,
    @Req() req: Request,
  ) {
    await this.casting.acceptInvite(
      user,
      params.token,
      body.characterId,
      body.consent,
      { ip: req.ip, userAgent: req.headers['user-agent'] },
    );
    return { code: 200, data: { ok: true } };
  }
}
