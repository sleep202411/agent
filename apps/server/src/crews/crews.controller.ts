/**
 * /aurora/crews/*  — crew CRUD endpoints.
 *
 *   POST   /aurora/crews                Create
 *   GET    /aurora/crews                List (public — visitors see brief cards)
 *   GET    /aurora/crews/my             "My Crews" — founded + joined for /profile tab
 *   GET    /aurora/crews/:id            Detail (public; pending-app count hidden from non-owners)
 *   PATCH  /aurora/crews/:id            Edit (owner only)
 *   PATCH  /aurora/crews/:id/listing    Show / hide in Crew Hall (owner only)
 *   DELETE /aurora/crews/:id            Soft delete (owner only)
 */
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuthService, CurrentUser, Public, ViewerCookie } from '../auth';
import type { AuthUser } from '../auth';
import { CURRENT_CELL } from '../common/region/current-cell';
import { CrewsService } from './crews.service';
import {
  CreateCrewSchema,
  type CreateCrewInput,
  UpdateCrewSchema,
  type UpdateCrewInput,
  UpdateCrewListingSchema,
  type UpdateCrewListingInput,
} from './dto';
import { parseIdParam } from './params';
import { ZodValidationPipe } from './zod.pipe';

@Controller('crews')
export class CrewsController {
  constructor(
    private readonly svc: CrewsService,
    private readonly authService: AuthService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: AuthUser,
    @ViewerCookie() cookie: string,
    @Body(new ZodValidationPipe(CreateCrewSchema)) body: CreateCrewInput,
  ) {
    await this.assertCreateAllowed(cookie);
    return this.svc.create(user.userId, body);
  }

  @Public()
  @Get()
  list(@Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.svc.list({
      limit: limit ? Number.parseInt(limit, 10) : undefined,
      cursor: cursor || undefined,
    });
  }

  @Get('my')
  my(@CurrentUser() user: AuthUser) {
    return this.svc.myCrews(user.userId);
  }

  @Public()
  @Get(':id')
  detail(@Param('id') idRaw: string, @CurrentUser() user?: AuthUser) {
    const id = parseIdParam(idRaw, 'id');
    return this.svc.detail(id, user?.userId ?? null);
  }

  @Patch(':id')
  update(
    @Param('id') idRaw: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpdateCrewSchema)) body: UpdateCrewInput,
  ) {
    const id = parseIdParam(idRaw, 'id');
    return this.svc.update(id, user.userId, body);
  }

  @Patch(':id/listing')
  updateListing(
    @Param('id') idRaw: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpdateCrewListingSchema))
    body: UpdateCrewListingInput,
  ) {
    const id = parseIdParam(idRaw, 'id');
    return this.svc.updateListing(id, user.userId, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') idRaw: string, @CurrentUser() user: AuthUser) {
    const id = parseIdParam(idRaw, 'id');
    await this.svc.softDelete(id, user.userId);
  }

  private async assertCreateAllowed(cookie: string) {
    if (CURRENT_CELL !== 'cn' || process.env.AUTH_DISABLED === 'true') return;

    const needsKyc = await this.authService.needsRealNameVerification(cookie);
    if (needsKyc === false) return;
    if (needsKyc === true) {
      throw new ForbiddenException({
        message: 'Identity verification required before creating a crew',
      });
    }

    throw new ServiceUnavailableException({
      message: 'Could not verify identity status; please try again',
    });
  }
}
