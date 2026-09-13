/**
 * NotificationController — REST surface for the inbox UI.
 *
 *   GET    /aurora/notifications              — paginated feed (cursor)
 *   GET    /aurora/notifications/unread-count — bell badge
 *   POST   /aurora/notifications/:id/read     — mark one read
 *   POST   /aurora/notifications/read-all     — clear the badge
 *
 * All endpoints scope to the authenticated user — there is no admin
 * surface for reading other users' inboxes. AuthGuard (global APP_GUARD)
 * already gates these; CurrentUser pulls the userId.
 */
import {
  BadRequestException,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  NOTIFICATION_FILTERS,
  type NotificationFilter,
} from '@repo/shared/notifications';
import { CurrentUser } from '../auth';
import type { AuthUser } from '../auth';
import { NotificationService } from './notification.service';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

@Controller('notifications')
export class NotificationController {
  constructor(private readonly svc: NotificationService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(
    @CurrentUser() user: AuthUser,
    @Query('limit') limitRaw?: string,
    @Query('cursor') cursor?: string,
    @Query('filter') filterRaw?: string,
  ) {
    const limit = clampLimit(limitRaw);
    const filter = filterRaw ?? 'all';
    if (!NOTIFICATION_FILTERS.includes(filter as NotificationFilter)) {
      throw new BadRequestException('Invalid notification filter');
    }
    return this.svc.list(user.userId, {
      limit,
      cursor,
      filter: filter as NotificationFilter,
    });
  }

  @Get('unread-crews')
  @Header('Cache-Control', 'no-store')
  unreadCrews(@CurrentUser() user: AuthUser) {
    return this.svc.unreadCrews(user.userId);
  }

  @Get('unread-crew-tasks')
  @Header('Cache-Control', 'no-store')
  unreadCrewTasks(@CurrentUser() user: AuthUser) {
    return this.svc.unreadCrewTasks(user.userId);
  }

  @Get('unread-count')
  @Header('Cache-Control', 'no-store')
  async unreadCount(@CurrentUser() user: AuthUser) {
    const count = await this.svc.unreadCount(user.userId);
    return { count };
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  async markRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const dto = await this.svc.markRead(user.userId, id);
    if (!dto) throw new NotFoundException('Notification not found');
    return dto;
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  async markAllRead(@CurrentUser() user: AuthUser) {
    const count = await this.svc.markAllRead(user.userId);
    return { count };
  }
}

function clampLimit(raw?: string): number {
  const n = raw ? Number.parseInt(raw, 10) : DEFAULT_LIMIT;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}
