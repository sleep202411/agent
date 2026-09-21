import {
  BadGatewayException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  WorldModelSessionStatus,
  WorldModelTravelStatus as PrismaTravelStatus,
  WorldModelWorldStatus as PrismaWorldStatus,
  type Prisma,
  type WorldModelTravel as TravelRow,
  type WorldModelWorld as WorldRow,
} from '@prisma/client';
import type {
  BindWorldTravelRequest,
  CloseWorldSessionRequest,
  CreateWorldRequest,
  CreateWorldSessionRequest,
  ReportWorldTravelStatusRequest,
  WorldModelWorld,
} from '@repo/shared';
import { PrismaService } from '../infra/db/db.module';
import { canonicalJsonHash } from '../story-studio/canonical-json';
import { StoryPermissionService } from '../story-studio/story-permission.service';
import { WorldModelProviderRegistry } from './world-model-provider.registry';

@Injectable()
export class WorldModelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: StoryPermissionService,
    private readonly providers: WorldModelProviderRegistry,
  ) {}

  async listProviders(
    userId: string,
    workspaceId: string,
    storyProjectId: string,
  ) {
    await this.requireProject(
      userId,
      workspaceId,
      storyProjectId,
      'story.read',
    );
    return this.providers.list().map((provider) => provider.capabilities());
  }

  async createWorld(
    userId: string,
    workspaceId: string,
    storyProjectId: string,
    input: CreateWorldRequest,
    idempotencyKey: string,
  ): Promise<WorldModelWorld> {
    await this.requireProject(
      userId,
      workspaceId,
      storyProjectId,
      'story.generate',
    );
    const submissionKey = canonicalJsonHash({
      userId,
      storyProjectId,
      idempotencyKey,
    });
    const requestFingerprint = canonicalJsonHash(input);
    const existing = await this.prisma.worldModelWorld.findUnique({
      where: { submissionKey },
    });
    if (existing) {
      assertMatchingWorldSubmission(existing, requestFingerprint);
      return mapWorld(existing);
    }

    const reservation = await this.reserveWorldSubmission({
      userId,
      workspaceId,
      storyProjectId,
      submissionKey,
      requestFingerprint,
      input,
    });
    const reserved = reservation.row;
    if (reserved.requestFingerprint !== requestFingerprint) {
      assertMatchingWorldSubmission(reserved, requestFingerprint);
    }
    // Only the request that won the unique-key reservation may cross the
    // provider boundary. Concurrent duplicates observe the reserved row and
    // return it without creating a second paid world.
    if (
      !reservation.created ||
      !isReservedWorldSubmission(reserved.providerData)
    ) {
      return mapWorld(reserved);
    }

    const provider = this.providers.require(input.providerKey);
    try {
      const world = await provider.createWorld(input);
      const row = await this.prisma.worldModelWorld.update({
        where: { id: reserved.id },
        data: {
          providerWorldId: world.providerWorldId,
          mode: world.mode,
          status: world.status as PrismaWorldStatus,
          name: world.name,
          firstFrameUrl: world.firstFrameUrl,
          providerData: world.providerData as Prisma.InputJsonValue,
          errorCode: world.error?.code,
          errorMessage: world.error?.message,
        },
      });
      return mapWorld(row);
    } catch (cause) {
      await this.prisma.worldModelWorld.update({
        where: { id: reserved.id },
        data: {
          status: PrismaWorldStatus.failed,
          errorCode: 'WORLD_MODEL_CREATE_FAILED',
          errorMessage:
            cause instanceof Error
              ? cause.message
              : 'World creation failed after submission.',
          providerData: {
            submissionState: 'failed',
            retrySuppressed: true,
          },
        },
      });
      throw cause;
    }
  }

  async listWorlds(
    userId: string,
    workspaceId: string,
    storyProjectId: string,
  ) {
    await this.requireProject(
      userId,
      workspaceId,
      storyProjectId,
      'story.read',
    );
    const rows = await this.prisma.worldModelWorld.findMany({
      where: { storyProjectId, workspaceId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(mapWorld);
  }

  async getWorld(
    userId: string,
    workspaceId: string,
    storyProjectId: string,
    worldId: string,
  ) {
    await this.requireProject(
      userId,
      workspaceId,
      storyProjectId,
      'story.read',
    );
    const row = await this.requireWorld(workspaceId, storyProjectId, worldId);
    if (
      row.status !== PrismaWorldStatus.generating ||
      isReservedWorldSubmission(row.providerData)
    ) {
      return mapWorld(row);
    }

    const provider = this.providers.require(row.providerKey);
    const world = await provider.getWorld(row.providerWorldId);
    // Provider reads can finish out of order. A terminal world must never
    // be replaced by an older in-flight poll response.
    await this.prisma.worldModelWorld.updateMany({
      where: { id: row.id, status: PrismaWorldStatus.generating },
      data: {
        status: world.status as PrismaWorldStatus,
        name: world.name,
        firstFrameUrl: world.firstFrameUrl,
        providerData: world.providerData as Prisma.InputJsonValue,
        errorCode: world.error?.code ?? null,
        errorMessage: world.error?.message ?? null,
      },
    });
    return mapWorld(
      await this.requireWorld(workspaceId, storyProjectId, worldId),
    );
  }

  async createSession(
    userId: string,
    workspaceId: string,
    storyProjectId: string,
    worldId: string,
    input: CreateWorldSessionRequest,
  ) {
    await this.requireProject(
      userId,
      workspaceId,
      storyProjectId,
      'story.generate',
    );
    const world = await this.requireWorld(workspaceId, storyProjectId, worldId);
    if (world.status !== PrismaWorldStatus.ready) {
      throw new ConflictException({
        code: 'WORLD_MODEL_WORLD_NOT_READY',
        message: 'The world must be ready before starting a session.',
      });
    }

    const provider = this.providers.require(world.providerKey);
    const session = await provider.createSession({
      providerWorldId: world.providerWorldId,
      tokenSeconds: input.tokenSeconds,
    });
    const now = Date.now();
    const row = await this.prisma.worldModelSession.create({
      data: {
        workspaceId,
        storyProjectId,
        worldId,
        providerSessionId: session.providerSessionId,
        heartbeatIntervalSeconds: session.heartbeatIntervalSeconds,
        sessionTimeoutSeconds: session.sessionTimeoutSeconds,
        expiresAt: new Date(now + session.sessionTimeoutSeconds * 1_000),
        createdByUserId: userId,
      },
    });
    return {
      id: row.id,
      worldId,
      providerKey: world.providerKey,
      heartbeatIntervalSeconds: session.heartbeatIntervalSeconds,
      sessionTimeoutSeconds: session.sessionTimeoutSeconds,
      maxExperienceSeconds: input.maxExperienceSeconds ?? null,
      connection: session.connection,
    };
  }

  async heartbeat(
    userId: string,
    workspaceId: string,
    storyProjectId: string,
    sessionId: string,
  ) {
    await this.requireProject(
      userId,
      workspaceId,
      storyProjectId,
      'story.read',
    );
    const session = await this.requireActiveSession(
      workspaceId,
      storyProjectId,
      sessionId,
    );
    const provider = this.providers.require(session.world.providerKey);
    const heartbeat = await provider.heartbeat(session.providerSessionId);
    const status = heartbeat.alive
      ? WorldModelSessionStatus.active
      : WorldModelSessionStatus.expired;
    // Closing/expiry or rebinding may have happened during the provider call.
    const updated = await this.prisma.worldModelSession.updateMany({
      where: {
        id: session.id,
        status: WorldModelSessionStatus.active,
        providerSessionId: session.providerSessionId,
      },
      data: {
        status,
        lastHeartbeatAt: new Date(),
        expiresAt: new Date(Date.now() + session.sessionTimeoutSeconds * 1_000),
        closedAt: heartbeat.alive ? null : new Date(),
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException({
        code: 'WORLD_MODEL_SESSION_INACTIVE',
        message: 'The world session changed or is no longer active.',
      });
    }
    return heartbeat;
  }

  async bindTravel(
    userId: string,
    workspaceId: string,
    storyProjectId: string,
    sessionId: string,
    input: BindWorldTravelRequest,
  ) {
    await this.requireProject(
      userId,
      workspaceId,
      storyProjectId,
      'story.generate',
    );
    const session = await this.requireActiveSession(
      workspaceId,
      storyProjectId,
      sessionId,
    );
    const provider = this.providers.require(session.world.providerKey);
    const bound = await provider.bindTravel({
      providerSessionId: session.providerSessionId,
      providerTravelId: input.providerTravelId,
    });
    if (!bound.bound) {
      throw new BadGatewayException({
        code: 'WORLD_MODEL_TRAVEL_BIND_FAILED',
        message: 'The world model provider rejected the travel binding.',
      });
    }

    const [, travel] = await this.prisma.$transaction([
      this.prisma.worldModelSession.update({
        where: { id: session.id },
        data: { providerSessionId: bound.providerSessionId },
      }),
      this.prisma.worldModelTravel.upsert({
        where: { sessionId: session.id },
        create: {
          workspaceId,
          storyProjectId,
          worldId: session.worldId,
          sessionId: session.id,
          providerTravelId: input.providerTravelId,
          status: PrismaTravelStatus.init,
          startedAt: new Date(),
        },
        update: {
          providerTravelId: input.providerTravelId,
          status: PrismaTravelStatus.init,
          rtcStatus: null,
          providerUpdatedAt: null,
          providerData: {},
          artifactData: {},
          startedAt: new Date(),
          endedAt: null,
        },
      }),
    ]);
    return mapBoundTravel(travel);
  }

  async refreshToken(
    userId: string,
    workspaceId: string,
    storyProjectId: string,
    sessionId: string,
    tokenSeconds: number,
  ) {
    await this.requireProject(
      userId,
      workspaceId,
      storyProjectId,
      'story.read',
    );
    const session = await this.requireActiveSession(
      workspaceId,
      storyProjectId,
      sessionId,
    );
    return this.providers
      .require(session.world.providerKey)
      .refreshToken(tokenSeconds);
  }

  async closeSession(
    userId: string,
    workspaceId: string,
    storyProjectId: string,
    sessionId: string,
    input: CloseWorldSessionRequest,
  ) {
    await this.requireProject(
      userId,
      workspaceId,
      storyProjectId,
      'story.generate',
    );
    const session = await this.requireSession(
      workspaceId,
      storyProjectId,
      sessionId,
    );
    if (session.status !== WorldModelSessionStatus.active)
      return { closed: false };
    const result = await this.providers
      .require(session.world.providerKey)
      .closeSession({
        providerSessionId: session.providerSessionId,
        travelCompleted: input.travelCompleted,
      });
    const closedAt = new Date();
    if (input.travelCompleted) {
      await this.prisma.$transaction([
        this.prisma.worldModelSession.update({
          where: { id: session.id },
          data: { status: WorldModelSessionStatus.closed, closedAt },
        }),
        this.prisma.worldModelTravel.updateMany({
          where: { sessionId: session.id },
          data: {
            status: PrismaTravelStatus.completed,
            endedAt: closedAt,
          },
        }),
      ]);
    } else {
      await this.prisma.worldModelSession.update({
        where: { id: session.id },
        data: { status: WorldModelSessionStatus.closed, closedAt },
      });
    }
    return result;
  }

  async syncTravelStatus(
    userId: string,
    workspaceId: string,
    storyProjectId: string,
    travelId: string,
    input: ReportWorldTravelStatusRequest,
  ) {
    await this.requireProject(
      userId,
      workspaceId,
      storyProjectId,
      'story.read',
    );
    const travel = await this.requireTravel(
      workspaceId,
      storyProjectId,
      travelId,
    );
    if (
      travel.status === PrismaTravelStatus.completed ||
      travel.status === PrismaTravelStatus.failed
    )
      return mapTravelStatus(travel);
    const provider = this.providers.require(travel.world.providerKey);
    const status = await provider.syncTravelStatus({
      providerTravelId: travel.providerTravelId,
      streamStatus: input.streamStatus,
      streamStatusChangedAtMs: input.streamStatusChangedAtMs,
    });
    // Do not overwrite a newer lifecycle transition or a rebound travel.
    await this.prisma.worldModelTravel.updateMany({
      where: {
        id: travel.id,
        status: travel.status,
        providerTravelId: travel.providerTravelId,
      },
      data: {
        status: status.status as PrismaTravelStatus,
        rtcStatus: status.rtcStatus,
        providerUpdatedAt: parseProviderDate(status.updatedAt),
        providerData: status.providerData as Prisma.InputJsonValue,
        endedAt: ['failed', 'completed'].includes(status.status)
          ? new Date()
          : null,
      },
    });
    return mapTravelStatus(
      await this.requireTravel(workspaceId, storyProjectId, travelId),
    );
  }

  async getTravelArtifacts(
    userId: string,
    workspaceId: string,
    storyProjectId: string,
    travelId: string,
  ) {
    await this.requireProject(
      userId,
      workspaceId,
      storyProjectId,
      'story.read',
    );
    const travel = await this.requireTravel(
      workspaceId,
      storyProjectId,
      travelId,
    );
    const artifacts = await this.providers
      .require(travel.world.providerKey)
      .getTravelArtifacts(travel.providerTravelId);
    await this.prisma.worldModelTravel.update({
      where: { id: travel.id },
      data: { artifactData: artifacts as Prisma.InputJsonValue },
    });
    return { travelId: travel.id, ...artifacts };
  }

  private async requireProject(
    userId: string,
    workspaceId: string,
    storyProjectId: string,
    capability: 'story.read' | 'story.generate',
  ) {
    const authorization = await this.permissions.requireProject(
      userId,
      storyProjectId,
      capability,
    );
    if (authorization.project.workspaceId !== workspaceId)
      throw resourceNotFound();
    return authorization.project;
  }

  private async requireWorld(
    workspaceId: string,
    storyProjectId: string,
    id: string,
  ) {
    const row = await this.prisma.worldModelWorld.findFirst({
      where: { id, workspaceId, storyProjectId },
    });
    if (!row) throw resourceNotFound();
    return row;
  }

  private async reserveWorldSubmission(input: {
    userId: string;
    workspaceId: string;
    storyProjectId: string;
    submissionKey: string;
    requestFingerprint: string;
    input: CreateWorldRequest;
  }) {
    const result = await this.prisma.worldModelWorld.createMany({
      data: [
        {
          workspaceId: input.workspaceId,
          storyProjectId: input.storyProjectId,
          providerKey: input.input.providerKey,
          providerWorldId: `pending:${input.submissionKey}`,
          submissionKey: input.submissionKey,
          requestFingerprint: input.requestFingerprint,
          mode: input.input.mode,
          status: PrismaWorldStatus.generating,
          name: null,
          prompt: input.input.prompt,
          firstFrameUrl: input.input.reference.firstFrameUrl ?? null,
          request: input.input as Prisma.InputJsonValue,
          providerData: { submissionState: 'reserved' },
          createdByUserId: input.userId,
        },
      ],
      skipDuplicates: true,
    });
    const row = await this.prisma.worldModelWorld.findUniqueOrThrow({
      where: { submissionKey: input.submissionKey },
    });
    return { row, created: result.count === 1 };
  }

  private async requireSession(
    workspaceId: string,
    storyProjectId: string,
    id: string,
  ) {
    const row = await this.prisma.worldModelSession.findFirst({
      where: { id, workspaceId, storyProjectId },
      include: { world: true },
    });
    if (!row) throw resourceNotFound();
    return row;
  }

  private async requireActiveSession(
    workspaceId: string,
    storyProjectId: string,
    id: string,
  ) {
    const row = await this.requireSession(workspaceId, storyProjectId, id);
    if (
      row.status !== WorldModelSessionStatus.active ||
      row.expiresAt <= new Date()
    ) {
      throw new ConflictException({
        code: 'WORLD_MODEL_SESSION_INACTIVE',
        message: 'The world session is no longer active.',
      });
    }
    return row;
  }

  private async requireTravel(
    workspaceId: string,
    storyProjectId: string,
    id: string,
  ) {
    const row = await this.prisma.worldModelTravel.findFirst({
      where: { id, workspaceId, storyProjectId },
      include: { world: true },
    });
    if (!row) throw resourceNotFound();
    return row;
  }
}

function isReservedWorldSubmission(value: Prisma.JsonValue) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    value.submissionState === 'reserved'
  );
}

function assertMatchingWorldSubmission(
  row: WorldRow,
  requestFingerprint: string,
) {
  if (row.requestFingerprint === requestFingerprint) return;
  throw new ConflictException({
    code: 'WORLD_MODEL_IDEMPOTENCY_KEY_REUSED',
    message:
      'This world creation key was already used for a different definition.',
  });
}

function mapWorld(row: WorldRow): WorldModelWorld {
  return {
    id: row.id,
    storyProjectId: row.storyProjectId,
    providerKey: row.providerKey,
    mode: row.mode as WorldModelWorld['mode'],
    status: row.status,
    name: row.name,
    prompt: row.prompt,
    firstFrameUrl: row.firstFrameUrl,
    error:
      row.errorCode && row.errorMessage
        ? { code: row.errorCode, message: row.errorMessage }
        : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapBoundTravel(row: TravelRow) {
  return {
    id: row.id,
    sessionId: row.sessionId,
    worldId: row.worldId,
    status: row.status,
  };
}

function mapTravelStatus(row: TravelRow) {
  return {
    id: row.id,
    worldId: row.worldId,
    status: row.status,
    rtcStatus: row.rtcStatus,
    updatedAt: row.providerUpdatedAt?.toISOString() ?? null,
  };
}

function parseProviderDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function resourceNotFound() {
  return new NotFoundException({
    code: 'WORLD_MODEL_RESOURCE_NOT_FOUND',
    message: 'World model resource not found.',
  });
}
