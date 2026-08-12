import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/db/db.module';
import {
  AgentOsCanvasShotsService,
  type AgentOsCanvasShotRow,
} from '../agent-os-canvas-shots.service';
import {
  CharactersUpsertInputSchema,
  ShotsDeleteInputSchema,
  ShotsUpsertInputSchema,
} from '../agent-os-domain.dto';
import { AgentOsProjectContextService } from '../agent-os-project-context.service';
import type {
  AgentOsCapabilityExecuteInput,
  AgentOsCapabilityHandler,
} from './capability-handler';

const PLATFORM_TOOL_IDS = new Set([
  'characters.list',
  'characters.upsert',
  'storyboard.listShots',
  'storyboard.upsertShots',
  'storyboard.deleteShots',
  'canvas.read',
  'canvas.applyPatch',
]);

type StoredCharacter = {
  id: string;
  name: Record<string, string>;
  summary: string;
};

@Injectable()
export class PlatformAgentCapabilityHandler implements AgentOsCapabilityHandler {
  readonly projectKind = 'platform' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: AgentOsProjectContextService,
    private readonly canvasShots: AgentOsCanvasShotsService,
  ) {}

  supports(toolId: string): boolean {
    return PLATFORM_TOOL_IDS.has(toolId);
  }

  async execute(input: AgentOsCapabilityExecuteInput): Promise<unknown> {
    switch (input.toolId) {
      case 'characters.list':
        return this.listCharacters(input.actorId, input.projectId);
      case 'characters.upsert':
        return this.upsertCharacters(input);
      case 'storyboard.listShots':
        return this.listShots(input);
      case 'storyboard.upsertShots':
        return this.upsertShots(input);
      case 'storyboard.deleteShots':
        return this.deleteShots(input);
      case 'canvas.read':
        return this.readCanvas(input);
      case 'canvas.applyPatch':
        return this.applyCanvasPatch(input);
      default:
        throw new Error(`Platform handler does not implement ${input.toolId}`);
    }
  }

  private async requireEdit(actorId: string, projectId: string) {
    await this.projects.authorizeWrite(actorId, {
      projectId,
      projectKind: 'platform',
    });
  }

  private async requireRead(actorId: string, projectId: string) {
    await this.projects.authorizeRead(actorId, {
      projectId,
      projectKind: 'platform',
    });
  }

  private async listShots(input: AgentOsCapabilityExecuteInput) {
    await this.requireRead(input.actorId, input.projectId);
    // The canvas document is the store: this returns the whole board, including
    // shots the user authored by hand, and `revision` anchors to that document.
    const board = await this.canvasShots.listShots({
      actorId: input.actorId,
      projectId: input.projectId,
      documentId: requiredCanvasDocumentId(input.workbenchContext),
    });
    return {
      revision: board.revision,
      shots: board.shots.map(toShotSummary),
    };
  }

  private async upsertShots(input: AgentOsCapabilityExecuteInput) {
    const args = ShotsUpsertInputSchema.parse(input.arguments);
    await this.requireEdit(input.actorId, input.projectId);

    // One store, one write. Existence checks happen inside the same hydrate
    // that performs the mutation, so a shot can never be reported as written
    // to a board that did not receive it.
    const result = await this.canvasShots.applyShots({
      actorId: input.actorId,
      projectId: input.projectId,
      documentId: requiredCanvasDocumentId(input.workbenchContext),
      shots: args.shots,
      idempotencyKey: input.idempotencyKey,
      skillResolutionId: input.skillResolutionId,
      skillVersionIds: input.skillVersionIds,
    });

    return {
      revision: result.revision,
      // nodeId travels with the result so the UI can offer "show me on the
      // canvas" — a write the user cannot find is barely a write.
      written: result.written,
      canvasDocumentId: result.documentId,
      idempotencyKey: input.idempotencyKey,
      ...(isStale(args.baseRevision, result.previousRevision)
        ? { staleBaseRevision: true }
        : {}),
    };
  }

  private async deleteShots(input: AgentOsCapabilityExecuteInput) {
    const args = ShotsDeleteInputSchema.parse(input.arguments);
    await this.requireEdit(input.actorId, input.projectId);

    const result = await this.canvasShots.deleteShots({
      actorId: input.actorId,
      projectId: input.projectId,
      documentId: requiredCanvasDocumentId(input.workbenchContext),
      shotIds: [...new Set(args.shotIds)],
      idempotencyKey: input.idempotencyKey,
      skillResolutionId: input.skillResolutionId,
      skillVersionIds: input.skillVersionIds,
    });

    return {
      revision: result.revision,
      deleted: result.deleted,
      canvasDocumentId: result.documentId,
      idempotencyKey: input.idempotencyKey,
      ...(isStale(args.baseRevision, result.previousRevision)
        ? { staleBaseRevision: true }
        : {}),
    };
  }

  private async listCharacters(actorId: string, projectId: string) {
    await this.requireRead(actorId, projectId);
    const state = await this.ensureState(projectId);
    const characters = parseCharacters(state.characters);
    return {
      revision: state.revision,
      characters: characters.map((character) => ({
        id: character.id,
        name: primaryName(character.name),
        summary: character.summary,
      })),
    };
  }

  private async upsertCharacters(input: AgentOsCapabilityExecuteInput) {
    const args = CharactersUpsertInputSchema.parse(input.arguments);
    await this.requireEdit(input.actorId, input.projectId);

    return this.prisma.$transaction(async (tx) => {
      const project = await tx.platformProject.findFirst({
        where: { id: input.projectId, deletedAt: null },
        select: { id: true, workspaceId: true },
      });
      if (!project) {
        throw new NotFoundException({
          code: 'PROJECT_NOT_FOUND',
          message: 'Platform project not found.',
        });
      }
      let state = await tx.agentOsProjectState.findUnique({
        where: { projectId: input.projectId },
      });
      if (!state) {
        state = await tx.agentOsProjectState.create({
          data: {
            projectId: project.id,
            workspaceId: project.workspaceId,
            revision: 0,
            characters: [],
            scriptSections: [],
          },
        });
      }
      if (state.revision !== args.baseRevision) {
        throw new ConflictException({
          code: 'PROJECT_VERSION_CONFLICT',
          message: `Expected revision ${args.baseRevision}, current is ${state.revision}`,
          expected: args.baseRevision,
          actual: state.revision,
        });
      }

      const next = new Map(
        parseCharacters(state.characters).map(
          (character) => [character.id, character] as const,
        ),
      );
      const written: Array<{ id: string; name: string }> = [];
      for (const character of args.characters) {
        const intent = character.intent ?? 'create';
        if (intent === 'create' && next.has(character.id)) {
          throw new UnprocessableEntityException({
            code: 'CHARACTER_EXISTS',
            message: `Character ${character.id} already exists`,
          });
        }
        next.set(character.id, {
          id: character.id,
          name: character.name,
          summary: character.summary,
        });
        written.push({
          id: character.id,
          name: primaryName(character.name),
        });
      }

      const updated = await tx.agentOsProjectState.updateMany({
        where: {
          projectId: input.projectId,
          revision: state.revision,
        },
        data: {
          characters: [...next.values()] as unknown as Prisma.InputJsonValue,
          revision: { increment: 1 },
          updatedByUserId: input.actorId,
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException({
          code: 'PROJECT_CAS_LOST',
          message: 'Agent OS project state changed concurrently.',
        });
      }

      return {
        projectRevision: state.revision + 1,
        written,
        idempotencyKey: input.idempotencyKey,
      };
    });
  }

  private async readCanvas(input: AgentOsCapabilityExecuteInput) {
    await this.requireRead(input.actorId, input.projectId);
    return this.canvasShots.readCanvasSummary({
      actorId: input.actorId,
      projectId: input.projectId,
      documentId: requiredCanvasDocumentId(input.workbenchContext),
    });
  }

  private async applyCanvasPatch(input: AgentOsCapabilityExecuteInput) {
    await this.requireEdit(input.actorId, input.projectId);
    const raw = input.arguments as {
      baseDraftRevision?: number;
      baseLayoutRevision?: number;
      operations?: Array<{
        operationId?: string;
        kind: string;
        payload: Record<string, unknown>;
      }>;
    };
    if (
      typeof raw?.baseDraftRevision !== 'number' ||
      typeof raw?.baseLayoutRevision !== 'number' ||
      !Array.isArray(raw.operations) ||
      raw.operations.length === 0
    ) {
      throw new UnprocessableEntityException({
        code: 'INVALID_CANVAS_PATCH',
        message:
          'baseDraftRevision, baseLayoutRevision, and operations[] are required.',
      });
    }
    // Models invent invalid UUIDs; mint real ones before canvas CRDT apply.
    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const operations = raw.operations.map((operation) => ({
      kind: operation.kind,
      payload: operation.payload ?? {},
      operationId:
        typeof operation.operationId === 'string' &&
        uuidRe.test(operation.operationId.trim())
          ? operation.operationId.trim()
          : randomUUID(),
    }));
    return this.canvasShots.applyPatch({
      actorId: input.actorId,
      projectId: input.projectId,
      documentId: requiredCanvasDocumentId(input.workbenchContext),
      baseDraftRevision: raw.baseDraftRevision,
      baseLayoutRevision: raw.baseLayoutRevision,
      operations,
      idempotencyKey: input.idempotencyKey,
      skillResolutionId: input.skillResolutionId,
      skillVersionIds: input.skillVersionIds,
    });
  }

  private async ensureState(projectId: string) {
    const project = await this.prisma.platformProject.findFirst({
      where: { id: projectId, deletedAt: null },
      select: { id: true, workspaceId: true },
    });
    if (!project) {
      throw new NotFoundException({
        code: 'PROJECT_NOT_FOUND',
        message: 'Platform project not found.',
      });
    }
    const existing = await this.prisma.agentOsProjectState.findUnique({
      where: { projectId },
    });
    if (existing) return existing;
    return this.prisma.agentOsProjectState.create({
      data: {
        projectId: project.id,
        workspaceId: project.workspaceId,
        revision: 0,
        characters: [],
        scriptSections: [],
      },
    });
  }
}

function requiredCanvasDocumentId(
  context: Readonly<Record<string, string>> | undefined,
): string {
  const documentId = context?.canvasDocumentId;
  if (!documentId) {
    throw new UnprocessableEntityException({
      code: 'AGENT_OS_PLATFORM_SECTION_REQUIRED',
      message: 'Canvas tools require an active chapter canvas.',
    });
  }
  return documentId;
}

function primaryName(name: Record<string, string>): string {
  return (
    name['zh-CN'] ??
    name.zh ??
    name['en-US'] ??
    name.en ??
    Object.values(name)[0] ??
    ''
  );
}

function parseCharacters(value: Prisma.JsonValue): StoredCharacter[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is StoredCharacter =>
      !!item &&
      typeof item === 'object' &&
      !Array.isArray(item) &&
      typeof (item as StoredCharacter).id === 'string',
  );
}

/**
 * Whether the caller's baseRevision was behind when the write landed. Reported,
 * never enforced: shot writes merge as CRDT updates, so rejecting on a stale
 * anchor would fail an agent write for an unrelated human keystroke.
 */
function isStale(baseRevision: number | undefined, actual: number): boolean {
  return baseRevision !== undefined && baseRevision !== actual;
}

/**
 * Board row → the shape storyboard.listShots promises the model. Blank fields
 * are omitted rather than sent as "": absent reads as "not set", and a 200-shot
 * board would otherwise spend most of its tokens on empty strings.
 */
function toShotSummary(row: AgentOsCanvasShotRow) {
  const summary: Record<string, unknown> = {
    id: row.id,
    authoredBy: row.agentAuthored ? 'agent' : 'human',
    title: row.title,
  };
  if (row.order) summary.order = row.order;
  if (row.prompt) summary.prompt = row.prompt;
  if (row.notes) summary.notes = row.notes;
  if (row.description) summary.description = row.description;
  if (row.shotSize) summary.shotSize = row.shotSize;
  if (row.perspective) summary.perspective = row.perspective;
  if (row.movement) summary.movement = row.movement;
  if (row.dialogue) summary.dialogue = row.dialogue;
  if (row.videoPrompt) summary.videoPrompt = row.videoPrompt;
  if (row.durationSeconds !== null) {
    summary.durationSeconds = row.durationSeconds;
  }
  return summary;
}
