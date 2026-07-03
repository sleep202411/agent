/**
 * StoryProjectsService — sovereign story-studio domain (design doc
 * docs/story-studio-project-schema-v1.md v2).
 *
 * Owns projects + drafts (+ releases, second batch). Invariants enforced
 * here, not in the client:
 *  - R1  title/summary single source of truth: a draft save extracts both
 *        from the snapshot and writes them through to the project row
 *        (clamped) in the SAME transaction.
 *  - R2  the write-through bumps the project row, so the owner list's
 *        `updatedAt` ordering stays fresh without joining the draft table.
 *  - R5  draft saves are CAS-guarded by `revision`; a stale write returns
 *        409 with the current snapshot so the losing tab can recover.
 *  - R7  releases are Restrict-FK'd; archive is a soft delete and a
 *        published project must be unpublished first.
 */
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StoryPublishState } from '@prisma/client';
import type { StoryDraft, StoryProject } from '@prisma/client';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import {
  STORY_TITLE_MAX,
  type CreateStoryProjectInput,
  type PatchStoryProjectInput,
  type PutStoryDraftInput,
  type StoryDraftDto,
  type StoryProjectDetailDto,
  type StoryProjectSummaryDto,
} from './dto';

const DEFAULT_TITLE = 'Untitled Story';
const DRAFT_SCHEMA_VERSION = 'story-studio-canvas-v1';

/** R1 — pull the display metadata out of a canvas snapshot, clamped. */
function extractDisplayMeta(content: Record<string, unknown>): {
  title?: string;
  summary?: string | null;
} {
  const meta: { title?: string; summary?: string | null } = {};
  if (typeof content.title === 'string' && content.title.trim()) {
    meta.title = content.title.trim().slice(0, STORY_TITLE_MAX);
  }
  if (typeof content.summary === 'string') {
    const summary = content.summary.trim();
    meta.summary = summary ? summary : null;
  }
  return meta;
}

@Injectable()
export class StoryProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    user: AuthUser,
    input: CreateStoryProjectInput,
  ): Promise<StoryProjectDetailDto> {
    const content = input.content ?? {
      schemaVersion: DRAFT_SCHEMA_VERSION,
      title: input.title ?? DEFAULT_TITLE,
      summary: '',
      canvas: { nodes: [], edges: [] },
    };
    const meta = extractDisplayMeta(content);

    const project = await this.prisma.storyProject.create({
      data: {
        ownerUserId: user.userId,
        workspaceId: input.workspaceId ?? null,
        title: input.title ?? meta.title ?? DEFAULT_TITLE,
        summary: meta.summary ?? null,
        locale: input.locale ?? 'zh-CN',
        sourceIpId: input.sourceIpId ?? null,
        draft: {
          create: {
            schemaVersion: DRAFT_SCHEMA_VERSION,
            content: content as Prisma.InputJsonObject,
            updatedByUserId: user.userId,
          },
        },
      },
      include: { draft: true },
    });
    return this.toDetail(project, project.draft!);
  }

  async list(user: AuthUser): Promise<{ items: StoryProjectSummaryDto[] }> {
    const rows = await this.prisma.storyProject.findMany({
      where: { ownerUserId: user.userId, status: 'active', deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
    return { items: rows.map((row) => this.toSummary(row)) };
  }

  async get(user: AuthUser, id: string): Promise<StoryProjectDetailDto> {
    const project = await this.requireOwnProject(user, id, { draft: true });
    return this.toDetail(project, project.draft!);
  }

  async patch(
    user: AuthUser,
    id: string,
    input: PatchStoryProjectInput,
  ): Promise<StoryProjectSummaryDto> {
    await this.requireOwnProject(user, id);
    const updated = await this.prisma.storyProject.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.summary !== undefined ? { summary: input.summary } : {}),
        ...(input.coverAssetId !== undefined
          ? { coverAssetId: input.coverAssetId }
          : {}),
        ...(input.locale !== undefined ? { locale: input.locale } : {}),
        ...(input.visibility !== undefined
          ? { visibility: input.visibility }
          : {}),
        ...(input.tags !== undefined
          ? { tags: input.tags as Prisma.InputJsonArray }
          : {}),
      },
    });
    return this.toSummary(updated);
  }

  /**
   * Draft autosave. CAS on `revision` (R5); on success the display metadata
   * is written through to the project row in the same transaction (R1/R2).
   * A stale write throws 409 carrying the CURRENT snapshot for recovery.
   */
  async putDraft(
    user: AuthUser,
    id: string,
    input: PutStoryDraftInput,
  ): Promise<{ revision: number; updatedAt: string }> {
    await this.requireOwnProject(user, id);
    const meta = extractDisplayMeta(input.content);

    const result = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.storyDraft.updateMany({
        where: { storyProjectId: id, revision: input.revision },
        data: {
          content: input.content as Prisma.InputJsonObject,
          schemaVersion: input.schemaVersion,
          revision: { increment: 1 },
          updatedBySessionId: input.sessionId ?? null,
          updatedByUserId: user.userId,
        },
      });
      if (claimed.count !== 1) return null;

      // R1 + R2: metadata write-through keeps the project row (the list's
      // source of truth and its ordering key) fresh on every draft save.
      const project = await tx.storyProject.update({
        where: { id },
        data: {
          ...(meta.title !== undefined ? { title: meta.title } : {}),
          ...(meta.summary !== undefined ? { summary: meta.summary } : {}),
          // No-op field write still bumps @updatedAt when meta is empty.
          version: { increment: 1 },
        },
        select: { updatedAt: true },
      });
      return { updatedAt: project.updatedAt };
    });

    if (!result) {
      const current = await this.prisma.storyDraft.findUnique({
        where: { storyProjectId: id },
      });
      if (!current) {
        throw new NotFoundException({
          code: 'STORY_DRAFT_NOT_FOUND',
          message: 'Story draft not found.',
        });
      }
      throw new ConflictException({
        code: 'DRAFT_REVISION_CONFLICT',
        currentRevision: current.revision,
        content: current.content,
        updatedAt: current.updatedAt.toISOString(),
        updatedBySessionId: current.updatedBySessionId,
      });
    }

    return {
      revision: input.revision + 1,
      updatedAt: result.updatedAt.toISOString(),
    };
  }

  /** Archive (soft delete). A published project must be unpublished first. */
  async archive(user: AuthUser, id: string): Promise<void> {
    const project = await this.requireOwnProject(user, id);
    if (project.publishState === StoryPublishState.published) {
      throw new ConflictException({
        code: 'STORY_PUBLISHED',
        message: 'Unpublish the story before archiving the project.',
      });
    }
    await this.prisma.storyProject.update({
      where: { id },
      data: { status: 'archived', deletedAt: new Date() },
    });
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private async requireOwnProject(
    user: AuthUser,
    id: string,
    include?: { draft: true },
  ): Promise<StoryProject & { draft?: StoryDraft | null }> {
    const project = await this.prisma.storyProject.findFirst({
      where: { id, ownerUserId: user.userId, deletedAt: null },
      ...(include ? { include } : {}),
    });
    if (!project) {
      throw new NotFoundException({
        code: 'STORY_PROJECT_NOT_FOUND',
        message: 'Story project not found.',
      });
    }
    return project;
  }

  private toSummary(row: StoryProject): StoryProjectSummaryDto {
    return {
      id: row.id,
      title: row.title,
      summary: row.summary,
      coverAssetId: row.coverAssetId,
      locale: row.locale,
      visibility: row.visibility,
      tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
      publishState: row.publishState,
      publishedVersion: row.publishedVersion,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toDraft(draft: StoryDraft): StoryDraftDto {
    return {
      schemaVersion: draft.schemaVersion,
      content: (draft.content ?? {}) as Record<string, unknown>,
      revision: draft.revision,
      updatedAt: draft.updatedAt.toISOString(),
    };
  }

  private toDetail(
    row: StoryProject,
    draft: StoryDraft,
  ): StoryProjectDetailDto {
    return {
      ...this.toSummary(row),
      workspaceId: row.workspaceId,
      sourceIpId: row.sourceIpId,
      draft: this.toDraft(draft),
    };
  }
}
