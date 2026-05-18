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
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth';
import type { AuthUser } from '../auth';
import { NotificationService } from './notification.service';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

@Controller('notifications')
export class NotificationController {
  constructor(private readonly svc: NotificationService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query('limit') limitRaw?: string,
    @Query('cursor') cursor?: string,
  ) {
    const limit = clampLimit(limitRaw);
    return this.svc.list(user.userId, { limit, cursor });
  }

  @Get('unread-count')
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
