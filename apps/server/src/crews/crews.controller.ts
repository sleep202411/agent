/**
 * /aurora/crews/*  — crew CRUD endpoints.
 *
 *   POST   /aurora/crews                Create
 *   GET    /aurora/crews                List (public — visitors see brief cards)
 *   GET    /aurora/crews/my             "My Crews" — founded + joined for /profile tab
 *   GET    /aurora/crews/:id            Detail (public; pending-app count hidden from non-owners)
 *   PATCH  /aurora/crews/:id            Edit (owner only)
 *   DELETE /aurora/crews/:id            Soft delete (owner only)
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser, Public } from '../auth';
import type { AuthUser } from '../auth';
import { CrewsService } from './crews.service';
import {
  CreateCrewSchema,
  type CreateCrewInput,
  UpdateCrewSchema,
  type UpdateCrewInput,
} from './dto';
import { parseIdParam } from './params';
import { ZodValidationPipe } from './zod.pipe';

@Controller('crews')
export class CrewsController {
  constructor(private readonly svc: CrewsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateCrewSchema)) body: CreateCrewInput,
  ) {
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

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') idRaw: string, @CurrentUser() user: AuthUser) {
    const id = parseIdParam(idRaw, 'id');
    await this.svc.softDelete(id, user.userId);
  }
}
