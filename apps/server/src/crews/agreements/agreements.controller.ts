import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser, Public } from '../../auth';
import type { AuthUser } from '../../auth';
import { parseIdParam } from '../../common/params';
import { ZodValidationPipe } from '../../common/zod.pipe';
import {
  CreateCrewAgreementSchema,
  type CreateCrewAgreementInput,
  ListCrewAgreementsQuerySchema,
  type ListCrewAgreementsQuery,
} from '../dto';
import { CrewAgreementsService } from './agreements.service';

type RawBodyRequest = Request & { rawBody?: Buffer };

@Controller()
export class CrewAgreementsController {
  constructor(private readonly agreements: CrewAgreementsService) {}

  @Get('me/crew-agreements')
  mine(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListCrewAgreementsQuerySchema))
    query: ListCrewAgreementsQuery,
  ) {
    return this.agreements.listMine(user.userId, query);
  }

  @Get('crews/:crewId/agreements')
  list(
    @Param('crewId') crewId: string,
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListCrewAgreementsQuerySchema))
    query: ListCrewAgreementsQuery,
  ) {
    return this.agreements.list(
      parseIdParam(crewId, 'crewId'),
      user.userId,
      query,
    );
  }

  @Post('crews/:crewId/agreements')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('crewId') crewId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateCrewAgreementSchema))
    body: CreateCrewAgreementInput,
  ) {
    return this.agreements.create(
      parseIdParam(crewId, 'crewId'),
      user.userId,
      body,
    );
  }

  @Post('crew-agreements/:agreementId/sync')
  sync(
    @Param('agreementId') agreementId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.agreements.sync(
      parseIdParam(agreementId, 'agreementId'),
      user.userId,
    );
  }

  @Post('crew-agreements/:agreementId/archive/retry')
  retryArchive(
    @Param('agreementId') agreementId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.agreements.retryArchive(
      parseIdParam(agreementId, 'agreementId'),
      user.userId,
    );
  }

  @Post('crew-agreements/:agreementId/send/retry')
  retrySend(
    @Param('agreementId') agreementId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.agreements.retrySend(
      parseIdParam(agreementId, 'agreementId'),
      user.userId,
    );
  }

  @Post('crew-agreements/:agreementId/signing-session')
  createSigningSession(
    @Param('agreementId') agreementId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.agreements.createSigningSession(
      parseIdParam(agreementId, 'agreementId'),
      user.userId,
    );
  }

  /**
   * BoldSign account-level webhook. Public only with respect to end-user auth;
   * every non-verification event must pass BoldSign HMAC verification before
   * the service touches agreement state.
   */
  @Public()
  @Post('webhooks/boldsign')
  @HttpCode(HttpStatus.OK)
  webhook(
    @Req() req: RawBodyRequest,
    @Headers('x-boldsign-signature')
    signature?: string | string[],
    @Headers('x-boldsign-event') event?: string | string[],
  ) {
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    return this.agreements.handleWebhook({
      rawBody,
      signatureHeader: firstHeader(signature),
      eventHeader: firstHeader(event),
    });
  }
}

function firstHeader(value?: string | string[]): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
