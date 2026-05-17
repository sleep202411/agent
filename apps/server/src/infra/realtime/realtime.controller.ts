/**
 * RealtimeController — endpoints the browser hits to bootstrap a
 * Web PubSub connection. The browser never sees the connection
 * string; it negotiates a short-lived JWT here and uses that JWT to
 * connect to Azure directly.
 */
import { Controller, Logger, Post } from '@nestjs/common';
import { CurrentUser } from '../../auth';
import type { AuthUser } from '../../auth';
import { WebPubSubService } from './web-pubsub.service';

@Controller('realtime')
export class RealtimeController {
  private readonly logger = new Logger(RealtimeController.name);

  constructor(private readonly webPubSub: WebPubSubService) {}

  @Post('negotiate/entity')
  async negotiateEntity(@CurrentUser() user: AuthUser) {
    const access = await this.webPubSub.issueEntityClientAccess(user.userId);
    if (!access) {
      return {
        code: 503,
        message: 'realtime_unconfigured',
      };
    }
    return {
      code: 200,
      data: access,
    };
  }

  @Post('negotiate/assets')
  async negotiateAssets(@CurrentUser() user: AuthUser) {
    const access = await this.webPubSub.issueAssetsClientAccess(user.userId);
    if (!access) {
      return {
        code: 503,
        message: 'realtime_unconfigured',
      };
    }
    return {
      code: 200,
      data: access,
    };
  }
}
