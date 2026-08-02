import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Public } from '../auth';

/**
 * Production provisioning boundary for the BoldSign account webhook.
 *
 * BoldSign assigns the signing secret only after this verification request
 * succeeds and the webhook is saved. Until the complete crew agreement
 * integration is promoted, this controller deliberately acknowledges only
 * the provider's verification probe and rejects every business event.
 */
@Controller()
export class BoldSignWebhookProvisioningController {
  @Public()
  @Post('webhooks/boldsign')
  @HttpCode(HttpStatus.OK)
  verify(
    @Headers('x-boldsign-event') eventHeader: string | string[] | undefined,
  ) {
    const header = firstHeader(eventHeader)?.trim().toLowerCase();
    if (header === 'verification') {
      return { received: true, verification: true };
    }

    throw new ServiceUnavailableException({
      message:
        'BoldSign business event handling is not enabled for this deployment.',
    });
  }
}

function firstHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
