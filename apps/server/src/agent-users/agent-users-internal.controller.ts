import {
  Body,
  Controller,
  Delete,
  Get,
  ForbiddenException,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { ServiceTokenGuard } from '../internal/service-token.guard';
import { RecordIpViewSchema, type RecordIpViewInput } from '../ip-commerce/dto';
import { IpCommerceService } from '../ip-commerce/ip-commerce.service';
import { AgentUserRunnerService } from './agent-user-runner.service';
import { AgentUsersService } from './agent-users.service';
import {
  AgentIpParamsSchema,
  AgentRunParamsSchema,
  AgentUserParamsSchema,
  CompleteAgentRunSchema,
  CreateAgentActionSchema,
  CreateAgentRunSchema,
  ListAgentMemoriesQuerySchema,
  ListInternalAgentUsersQuerySchema,
  UpsertAgentMemorySchema,
  type AgentIpParams,
  type AgentRunParams,
  type AgentUserParams,
  type CompleteAgentRunInput,
  type CreateAgentActionInput,
  type CreateAgentRunInput,
  type ListAgentMemoriesQuery,
  type ListInternalAgentUsersQuery,
  type UpsertAgentMemoryInput,
} from './dto';

@Public()
@UseGuards(ServiceTokenGuard)
@Controller('internal/agent-users')
export class AgentUsersInternalController {
  constructor(
    private readonly agentUsers: AgentUsersService,
    private readonly runner: AgentUserRunnerService,
    private readonly ipCommerce: IpCommerceService,
  ) {}

  @Get('active')
  async listActive(
    @Query(new ZodValidationPipe(ListInternalAgentUsersQuerySchema))
    query: ListInternalAgentUsersQuery,
  ) {
    return { code: 200, data: await this.agentUsers.listInternal(query) };
  }

  @Post('runner/tick')
  @HttpCode(200)
  async runTick() {
    return {
      code: 200,
      data: await this.runner.runTick({ trigger: 'manual_internal' }),
    };
  }

  @Post(':agentUserId/runs')
  @HttpCode(200)
  async createRun(
    @Param(new ZodValidationPipe(AgentUserParamsSchema))
    params: AgentUserParams,
    @Body(new ZodValidationPipe(CreateAgentRunSchema))
    body: CreateAgentRunInput,
  ) {
    return {
      code: 200,
      data: await this.agentUsers.createRun(params.agentUserId, body),
    };
  }

  @Patch('runs/:runId')
  async completeRun(
    @Param(new ZodValidationPipe(AgentRunParamsSchema))
    params: AgentRunParams,
    @Body(new ZodValidationPipe(CompleteAgentRunSchema))
    body: CompleteAgentRunInput,
  ) {
    return {
      code: 200,
      data: await this.agentUsers.completeRun(params.runId, body),
    };
  }

  @Post(':agentUserId/actions')
  @HttpCode(200)
  async createAction(
    @Param(new ZodValidationPipe(AgentUserParamsSchema))
    params: AgentUserParams,
    @Body(new ZodValidationPipe(CreateAgentActionSchema))
    body: CreateAgentActionInput,
  ) {
    return {
      code: 200,
      data: await this.agentUsers.createAction(params.agentUserId, body),
    };
  }

  @Post(':agentUserId/runner/run')
  @HttpCode(200)
  async runOneAgent(
    @Param(new ZodValidationPipe(AgentUserParamsSchema))
    params: AgentUserParams,
  ) {
    return {
      code: 200,
      data: await this.runner.runTick({
        trigger: 'manual_agent_internal',
        agentUserId: params.agentUserId,
      }),
    };
  }

  @Get(':agentUserId/memories')
  async listMemories(
    @Param(new ZodValidationPipe(AgentUserParamsSchema))
    params: AgentUserParams,
    @Query(new ZodValidationPipe(ListAgentMemoriesQuerySchema))
    query: ListAgentMemoriesQuery,
  ) {
    return {
      code: 200,
      data: await this.agentUsers.listMemories(params.agentUserId, query),
    };
  }

  @Post(':agentUserId/memories')
  @HttpCode(200)
  async upsertMemory(
    @Param(new ZodValidationPipe(AgentUserParamsSchema))
    params: AgentUserParams,
    @Body(new ZodValidationPipe(UpsertAgentMemorySchema))
    body: UpsertAgentMemoryInput,
  ) {
    return {
      code: 200,
      data: await this.agentUsers.upsertMemory(params.agentUserId, body),
    };
  }

  @Post(':agentUserId/ip/:ipId/view')
  @HttpCode(200)
  async recordIpView(
    @Param(new ZodValidationPipe(AgentIpParamsSchema))
    params: AgentIpParams,
    @Body(new ZodValidationPipe(RecordIpViewSchema))
    body: RecordIpViewInput,
  ) {
    await this.requireCapability(params.agentUserId, 'viewIp');
    const data = await this.ipCommerce.recordAgentIpView(
      params.agentUserId,
      params.ipId,
      body,
    );
    await this.agentUsers.createAction(params.agentUserId, {
      actionType: 'ip.view',
      targetType: 'ip',
      targetId: params.ipId,
      status: data.recorded ? 'succeeded' : 'skipped',
      idempotencyKey: body.idempotencyKey
        ? `agent:${params.agentUserId}:ip.view:${body.idempotencyKey}`
        : undefined,
      decision: {},
      input: {
        source: body.source,
        idempotencyKey: body.idempotencyKey ?? null,
      },
      result: data,
      metadata: {},
    });
    return { code: 200, data };
  }

  @Put(':agentUserId/ip/:ipId/like')
  async likeIp(
    @Param(new ZodValidationPipe(AgentIpParamsSchema))
    params: AgentIpParams,
  ) {
    await this.requireCapability(params.agentUserId, 'likeIp');
    const data = await this.ipCommerce.likeAgentIp(
      params.agentUserId,
      params.ipId,
    );
    await this.agentUsers.createAction(params.agentUserId, {
      actionType: 'ip.like',
      targetType: 'ip',
      targetId: params.ipId,
      status: 'succeeded',
      decision: {},
      input: {},
      result: data,
      metadata: {},
    });
    return { code: 200, data };
  }

  @Delete(':agentUserId/ip/:ipId/like')
  async unlikeIp(
    @Param(new ZodValidationPipe(AgentIpParamsSchema))
    params: AgentIpParams,
  ) {
    await this.agentUsers.ensureRunnable(params.agentUserId);
    const data = await this.ipCommerce.unlikeAgentIp(
      params.agentUserId,
      params.ipId,
    );
    await this.agentUsers.createAction(params.agentUserId, {
      actionType: 'ip.unlike',
      targetType: 'ip',
      targetId: params.ipId,
      status: 'succeeded',
      decision: {},
      input: {},
      result: data,
      metadata: {},
    });
    return { code: 200, data };
  }

  @Put(':agentUserId/ip/:ipId/collect')
  async collectIp(
    @Param(new ZodValidationPipe(AgentIpParamsSchema))
    params: AgentIpParams,
  ) {
    await this.requireCapability(params.agentUserId, 'collectIp');
    const data = await this.ipCommerce.saveAgentCollectionItem(
      params.agentUserId,
      params.ipId,
    );
    await this.agentUsers.createAction(params.agentUserId, {
      actionType: 'ip.collect',
      targetType: 'ip',
      targetId: params.ipId,
      status: 'succeeded',
      decision: {},
      input: {},
      result: data,
      metadata: {},
    });
    return { code: 200, data };
  }

  @Delete(':agentUserId/ip/:ipId/collect')
  async uncollectIp(
    @Param(new ZodValidationPipe(AgentIpParamsSchema))
    params: AgentIpParams,
  ) {
    await this.agentUsers.ensureRunnable(params.agentUserId);
    const data = await this.ipCommerce.removeAgentCollectionItem(
      params.agentUserId,
      params.ipId,
    );
    await this.agentUsers.createAction(params.agentUserId, {
      actionType: 'ip.uncollect',
      targetType: 'ip',
      targetId: params.ipId,
      status: 'succeeded',
      decision: {},
      input: {},
      result: data,
      metadata: {},
    });
    return { code: 200, data };
  }
  private async requireCapability(agentUserId: string, capability: string) {
    const agent = await this.agentUsers.ensureRunnable(agentUserId);
    const policy = agent.policy;
    const capabilities =
      policy && typeof policy === 'object' && !Array.isArray(policy)
        ? policy.capabilities
        : undefined;
    if (
      capabilities &&
      typeof capabilities === 'object' &&
      !Array.isArray(capabilities) &&
      capabilities[capability] === false
    ) {
      throw new ForbiddenException({
        code: 'AGENT_USER_CAPABILITY_DISABLED',
        message: `Agent capability ${capability} is disabled.`,
      });
    }
  }
}
