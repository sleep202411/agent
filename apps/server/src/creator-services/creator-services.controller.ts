/**
 *   GET    /aurora/creator-services                     Public listing
 *   GET    /aurora/creator-services/:id                 Detail (public if listed,
 *                                                       owner otherwise)
 *   POST   /aurora/creator-services                     Create (auth)
 *   PATCH  /aurora/creator-services/:id                 Update (owner)
 *   POST   /aurora/creator-services/:id/publish         Transition draft→listed (owner)
 *   POST   /aurora/creator-services/:id/pause           listed→paused (owner)
 *   POST   /aurora/creator-services/:id/resume          paused→listed (owner)
 *   DELETE /aurora/creator-services/:id                 archive (owner)
 *
 * Transitions are explicit verb endpoints rather than a generic
 * PATCH-status so each has its own precondition check + auditable
 * intent (publish enforces ≥ 1 package; archive is a one-way soft
 * delete; pause/resume only flip between two specific states).
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
import { parseIdParam } from '../common/params';
import { ZodValidationPipe } from '../common/zod.pipe';
import { CreatorServicesService } from './creator-services.service';
import {
  CreateServiceSchema,
  ListServicesQuerySchema,
  PublishServiceSchema,
  UpdateServiceSchema,
  type CreateServiceInput,
  type ListServicesQuery,
  type UpdateServiceInput,
} from './dto';

@Controller('creator-services')
export class CreatorServicesController {
  constructor(private readonly svc: CreatorServicesService) {}

  @Public()
  @Get()
  list(
    @Query(new ZodValidationPipe(ListServicesQuerySchema))
    query: ListServicesQuery,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.svc.list(query, user?.userId ?? null);
  }

  @Public()
  @Get(':id')
  detail(@Param('id') idRaw: string, @CurrentUser() user?: AuthUser) {
    return this.svc.detail(parseIdParam(idRaw, 'id'), user?.userId ?? null);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateServiceSchema))
    body: CreateServiceInput,
  ) {
    return this.svc.create(user.userId, body);
  }

  @Patch(':id')
  update(
    @Param('id') idRaw: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpdateServiceSchema))
    body: UpdateServiceInput,
  ) {
    return this.svc.update(parseIdParam(idRaw, 'id'), user.userId, body);
  }

  @Post(':id/publish')
  publish(
    @Param('id') idRaw: string,
    @CurrentUser() user: AuthUser,
    // Body is currently empty but the schema is wired so a future
    // "publish with overrides" payload doesn't require a route shape
    // change.
    @Body(new ZodValidationPipe(PublishServiceSchema))
    _body: unknown,
  ) {
    return this.svc.publish(parseIdParam(idRaw, 'id'), user.userId);
  }

  @Post(':id/pause')
  pause(@Param('id') idRaw: string, @CurrentUser() user: AuthUser) {
    return this.svc.pause(parseIdParam(idRaw, 'id'), user.userId);
  }

  @Post(':id/resume')
  resume(@Param('id') idRaw: string, @CurrentUser() user: AuthUser) {
    return this.svc.resume(parseIdParam(idRaw, 'id'), user.userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async archive(@Param('id') idRaw: string, @CurrentUser() user: AuthUser) {
    await this.svc.archive(parseIdParam(idRaw, 'id'), user.userId);
  }
}
