import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  StudioAgentCancelRunRequestSchema,
  StudioAgentResolveThreadRequestSchema,
  StudioAgentUpdatePermissionPolicyRequestSchema,
  type StudioAgentCancelRunRequest,
  type StudioAgentResolveThreadRequest,
  type StudioAgentUpdatePermissionPolicyRequest,
} from '@repo/shared/studio-agent-api';
import {
  StudioAgentInvocationRequestSchema,
  type StudioAgentInvocationRequest,
} from '@repo/shared/studio-agent-transport';
import { CurrentUser, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  StudioAgentRunParamsSchema,
  StudioAgentSnapshotQuerySchema,
  StudioAgentThreadParamsSchema,
  type StudioAgentRunParams,
  type StudioAgentSnapshotQuery,
  type StudioAgentThreadParams,
} from './studio-agent.dto';
import { StudioAgentAblyTokenIssuer } from './studio-agent.realtime';
import { StudioAgentService } from './studio-agent.service';

@Controller('studio-agent')
export class StudioAgentController {
  constructor(
    private readonly studioAgent: StudioAgentService,
    private readonly realtimeTokens: StudioAgentAblyTokenIssuer,
  ) {}

  @Post('threads/resolve')
  async resolveThread(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(StudioAgentResolveThreadRequestSchema))
    body: StudioAgentResolveThreadRequest,
  ) {
    return {
      code: 200,
      data: await this.studioAgent.resolveThread(user, body),
    };
  }

  @Get('threads/:threadId/snapshot')
  async snapshot(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StudioAgentThreadParamsSchema))
    params: StudioAgentThreadParams,
    @Query(new ZodValidationPipe(StudioAgentSnapshotQuerySchema))
    query: StudioAgentSnapshotQuery,
  ) {
    return {
      code: 200,
      data: await this.studioAgent.snapshot(user, params.threadId, query),
    };
  }

  /**
   * Wake a turn whose prompt is ALREADY on the channel.
   *
   * This is the endpoint `@ably/ai-transport`'s `ChatTransport` POSTs to, and
   * its shape is dictated by the library: `ClientView.send()` publishes the
   * user's `ai-input` first and only then issues this request, fire-and-forget.
   * Read that twice, because it inverts the usual order — by the time this
   * method runs, the message is on the channel and on every subscriber's
   * screen, and every refusal below refuses something already visible.
   *
   * That is not as loose as it sounds. The Ably capability is the first gate: a
   * token is minted for exactly one thread's channel, so a caller cannot
   * address a thread they did not prove access to, and the worst they can do is
   * put text on their own conversation. This endpoint is the second, and it is
   * where everything a capability cannot express is decided — ownership, scope,
   * quota, one-active-run, `clientMessageId` idempotency. A rejection reaches
   * the browser through the session's error emitter; the UI marks that message
   * failed rather than leaving it looking committed.
   *
   * There is no sibling route. `POST threads/:id/messages` is gone: two ways to
   * start a turn is two authorization paths to keep in step, and this one has
   * to exist because the library calls it.
   */
  @Post('invocations')
  async startInvocation(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(StudioAgentInvocationRequestSchema))
    body: StudioAgentInvocationRequest,
  ) {
    return {
      code: 200,
      data: await this.studioAgent.startInvocation(user, body),
    };
  }

  /**
   * Mint a short-lived Ably credential for exactly one thread.
   *
   * WHY THIS EXISTS AT ALL. The key in the server's environment is a ROOT key.
   * It can publish to, and read, every channel of every tenant, so it must
   * never reach a browser. The alternative people reach for — shipping a
   * separate subscribe-only key to the client — is not a smaller grant in the
   * way it sounds: its capability is `{"*": ["subscribe"]}`, i.e. every channel
   * of every tenant, forever, with no way to withdraw it from one user. A
   * minted token is the only shape that says "this person, this thread, until
   * it expires".
   *
   * AUTHORIZATION IS RE-RUN HERE, ON EVERY MINT. `requireThread` is the exact
   * check the thread read path above performs — ownership, active status, and
   * the scope authorizer. A grant withdrawn between two refreshes therefore
   * stops working at the next one; the window is the token TTL and nothing
   * longer, because Ably will not renew a token by itself.
   *
   * 404, NEVER 403, for a caller with no access: `requireThread` throws
   * `NotFoundException` and this route deliberately does not catch it, so a
   * thread you may not read is indistinguishable from a thread that does not
   * exist. Matching the rest of the module keeps thread ids unprobeable.
   *
   * `Cache-Control: no-store` because the response is a bearer credential and
   * this is a GET; nothing between here and the browser may keep a copy.
   */
  @Get('threads/:threadId/realtime-token')
  @Header('Cache-Control', 'no-store')
  async realtimeToken(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StudioAgentThreadParamsSchema))
    params: StudioAgentThreadParams,
  ) {
    await this.studioAgent.requireThread(user, params.threadId);
    return {
      code: 200,
      data: await this.realtimeTokens.issueThreadToken(
        params.threadId,
        user.userId,
      ),
    };
  }

  @Patch('threads/:threadId/permission-policy')
  async updatePermissionPolicy(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StudioAgentThreadParamsSchema))
    params: StudioAgentThreadParams,
    @Body(new ZodValidationPipe(StudioAgentUpdatePermissionPolicyRequestSchema))
    body: StudioAgentUpdatePermissionPolicyRequest,
  ) {
    return {
      code: 200,
      data: await this.studioAgent.updatePermissionPolicy(
        user,
        params.threadId,
        body,
      ),
    };
  }

  /**
   * "New conversation": retire this thread so the next resolve opens a fresh
   * one. No body — there is nothing to say about it beyond which thread.
   */
  @Post('threads/:threadId/archive')
  async archiveThread(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StudioAgentThreadParamsSchema))
    params: StudioAgentThreadParams,
  ) {
    return {
      code: 200,
      data: await this.studioAgent.archiveThread(user, params.threadId),
    };
  }

  @Post('threads/:threadId/runs/:runId/cancel')
  async cancelRun(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StudioAgentRunParamsSchema))
    params: StudioAgentRunParams,
    @Body(new ZodValidationPipe(StudioAgentCancelRunRequestSchema))
    body: StudioAgentCancelRunRequest,
  ) {
    return {
      code: 200,
      data: await this.studioAgent.cancelRun(
        user,
        params.threadId,
        params.runId,
        body,
      ),
    };
  }
}
