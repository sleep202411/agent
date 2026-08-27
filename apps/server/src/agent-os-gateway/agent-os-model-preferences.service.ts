import {
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth';
import { AiGenerationService } from '../ai-generation/ai-generation.service';
import { PrismaService } from '../infra/db/db.module';
import type { AgentOsModelPreferencesBody } from './agent-os-gateway.dto';
import { AgentOsProjectContextService } from './agent-os-project-context.service';
import { AgentOsWorkerClient } from './agent-os-worker.client';

@Injectable()
export class AgentOsModelPreferencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: AgentOsProjectContextService,
    private readonly generation: AiGenerationService,
    private readonly worker: AgentOsWorkerClient,
  ) {}

  async get(user: AuthUser, projectId: string) {
    const project = await this.projects.requireRead(user.userId, projectId);
    const row = await this.prisma.agentOsModelPreference.findUnique({
      where: {
        projectId_actorId: { projectId, actorId: user.userId },
      },
    });
    return row
      ? this.toDto(row)
      : {
          projectId,
          projectKind: project.projectKind,
          chatModelProfileId: null,
          imageModelId: null,
          videoModelId: null,
          version: 0,
          updatedAt: null,
        };
  }

  async update(
    user: AuthUser,
    projectId: string,
    input: AgentOsModelPreferencesBody,
  ) {
    const project = await this.projects.requireRead(user.userId, projectId);
    const current = await this.prisma.agentOsModelPreference.findUnique({
      where: {
        projectId_actorId: { projectId, actorId: user.userId },
      },
    });
    if ((current?.version ?? 0) !== input.expectedVersion) {
      throw preferenceConflict(current?.version ?? 0);
    }

    if (
      input.chatModelProfileId &&
      input.chatModelProfileId !== current?.chatModelProfileId
    ) {
      const offered = workerModelIds(await this.worker.listModels());
      if (!offered.has(input.chatModelProfileId)) {
        throw invalidPreference(
          'AGENT_OS_CHAT_MODEL_UNAVAILABLE',
          'The selected conversation model is not available in this deployment.',
          input.chatModelProfileId,
        );
      }
    }

    const mediaChanged =
      input.imageModelId !== (current?.imageModelId ?? null) ||
      input.videoModelId !== (current?.videoModelId ?? null);
    if (mediaChanged) {
      const models = await this.generation.listModels(
        user,
        project.workspaceId,
      );
      validateMediaModel(models, input.imageModelId, 'image');
      validateMediaModel(models, input.videoModelId, 'video');
    }

    if (!current) {
      try {
        const created = await this.prisma.agentOsModelPreference.create({
          data: {
            projectId,
            projectKind: project.projectKind,
            actorId: user.userId,
            chatModelProfileId: input.chatModelProfileId,
            imageModelId: input.imageModelId,
            videoModelId: input.videoModelId,
            version: 1,
          },
        });
        return this.toDto(created);
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw preferenceConflict(1);
        }
        throw error;
      }
    }

    const updated = await this.prisma.agentOsModelPreference.updateMany({
      where: { id: current.id, version: input.expectedVersion },
      data: {
        projectKind: project.projectKind,
        chatModelProfileId: input.chatModelProfileId,
        imageModelId: input.imageModelId,
        videoModelId: input.videoModelId,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      const winner = await this.prisma.agentOsModelPreference.findUnique({
        where: {
          projectId_actorId: { projectId, actorId: user.userId },
        },
        select: { version: true },
      });
      throw preferenceConflict(winner?.version ?? 0);
    }
    const row = await this.prisma.agentOsModelPreference.findUniqueOrThrow({
      where: { id: current.id },
    });
    return this.toDto(row);
  }

  private toDto(row: {
    projectId: string;
    projectKind: string;
    chatModelProfileId: string | null;
    imageModelId: string | null;
    videoModelId: string | null;
    version: number;
    updatedAt: Date;
  }) {
    return {
      projectId: row.projectId,
      projectKind: row.projectKind,
      chatModelProfileId: row.chatModelProfileId,
      imageModelId: row.imageModelId,
      videoModelId: row.videoModelId,
      version: row.version,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

function workerModelIds(value: unknown): Set<string> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return new Set();
  const models = (value as { models?: unknown }).models;
  if (!Array.isArray(models)) return new Set();
  return new Set(
    models.flatMap((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry))
        return [];
      const id = (entry as { id?: unknown }).id;
      return typeof id === 'string' && id.trim() ? [id] : [];
    }),
  );
}

function validateMediaModel(
  models: Awaited<ReturnType<AiGenerationService['listModels']>>,
  modelId: string | null,
  type: 'image' | 'video',
): void {
  if (!modelId) return;
  const model = models.find((candidate) => candidate.id === modelId);
  if (
    !model ||
    model.type !== type ||
    !model.enabled ||
    model.access?.allowed === false
  ) {
    throw invalidPreference(
      'AGENT_OS_GENERATION_MODEL_UNAVAILABLE',
      `The selected ${type} model is unavailable for this workspace.`,
      modelId,
    );
  }
}

function preferenceConflict(actualVersion: number): ConflictException {
  return new ConflictException({
    code: 'AGENT_OS_MODEL_PREFERENCES_VERSION_CONFLICT',
    message:
      'Model settings changed elsewhere. Refresh them before saving again.',
    actualVersion,
  });
}

function invalidPreference(
  code: string,
  message: string,
  modelId: string,
): UnprocessableEntityException {
  return new UnprocessableEntityException({ code, message, modelId });
}
