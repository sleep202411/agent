import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WorkspaceMemberRole } from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import { WorkspacePermissionService } from '../workspaces';

const CHARGE_SOURCE = 'content_review';
const LIST_LIMIT = 50;
const MAX_COMMENTS = 500;
const CONTENT_REVIEW_MAX_SECONDS = 3 * 60 * 60;

export interface CreateContentReviewRecordInput {
  mediaAssetId: string;
  chargeId: string;
  fileName: string;
  exportFileName: string;
  durationSeconds: number;
  creditsCharged: number;
  overview: object;
  details: readonly object[];
}

export interface ContentReviewRecordSummary {
  id: string;
  mediaAssetId: string;
  fileName: string;
  durationSeconds: number;
  creditsCharged: number;
  findingCount: number;
  suggestion: string | null;
  riskLevel: string | null;
  createdByUserId: string;
  createdAt: string;
}

export interface ContentReviewComment {
  id: string;
  seconds: number;
  body: string;
  createdByUserId: string;
  createdAt: string;
}

export interface ContentReviewRecordDetail extends ContentReviewRecordSummary {
  exportFileName: string;
  overview: Record<string, unknown>;
  details: Array<Record<string, unknown>>;
  comments: ContentReviewComment[];
}

@Injectable()
export class ContentReviewRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspacePermissions: WorkspacePermissionService,
  ) {}

  async list(
    userId: string,
    workspaceId: string | undefined,
  ): Promise<{ items: ContentReviewRecordSummary[] }> {
    const workspace = requireWorkspaceId(workspaceId);
    await this.workspacePermissions.requireWorkspaceRole(
      userId,
      workspace,
      WorkspaceMemberRole.viewer,
    );
    const rows = await this.prisma.contentReviewRecord.findMany({
      where: { workspaceId: workspace, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: LIST_LIMIT,
      select: {
        id: true,
        mediaAssetId: true,
        fileName: true,
        durationSeconds: true,
        creditsCharged: true,
        findingCount: true,
        overview: true,
        createdByUserId: true,
        createdAt: true,
      },
    });
    return { items: rows.map(toSummary) };
  }

  async get(
    userId: string,
    workspaceId: string | undefined,
    id: string,
  ): Promise<ContentReviewRecordDetail> {
    const workspace = requireWorkspaceId(workspaceId);
    await this.workspacePermissions.requireWorkspaceRole(
      userId,
      workspace,
      WorkspaceMemberRole.viewer,
    );
    const row = await this.prisma.contentReviewRecord.findFirst({
      where: { id, workspaceId: workspace, deletedAt: null },
    });
    if (!row) {
      throw new NotFoundException({
        code: 'CONTENT_REVIEW_RECORD_NOT_FOUND',
        msg: 'Content-review record not found.',
      });
    }
    return toDetail(row);
  }

  async addComment(
    userId: string,
    workspaceId: string | undefined,
    id: string,
    input: { seconds: number; body: string },
  ): Promise<ContentReviewRecordDetail> {
    const workspace = requireWorkspaceId(workspaceId);
    await this.workspacePermissions.requireWorkspaceRole(
      userId,
      workspace,
      WorkspaceMemberRole.viewer,
    );
    const body = input.body.trim();
    if (!body) {
      throw new BadRequestException({
        code: 'CONTENT_REVIEW_COMMENT_EMPTY',
        msg: 'Comment text is required.',
      });
    }
    if (
      !Number.isFinite(input.seconds) ||
      input.seconds < 0 ||
      input.seconds > CONTENT_REVIEW_MAX_SECONDS
    ) {
      throw new BadRequestException({
        code: 'CONTENT_REVIEW_COMMENT_TIME_INVALID',
        msg: 'Comment time is invalid.',
      });
    }
    const comment: ContentReviewComment = {
      id: randomUUID(),
      seconds: input.seconds,
      body,
      createdByUserId: userId,
      createdAt: new Date().toISOString(),
    };
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.contentReviewRecord.findFirst({
        where: { id, workspaceId: workspace, deletedAt: null },
      });
      if (!row) {
        throw new NotFoundException({
          code: 'CONTENT_REVIEW_RECORD_NOT_FOUND',
          msg: 'Content-review record not found.',
        });
      }
      const comments = parseComments(row.comments);
      if (comments.length >= MAX_COMMENTS) {
        throw new ConflictException({
          code: 'CONTENT_REVIEW_COMMENTS_FULL',
          msg: 'This review cannot take more comments.',
        });
      }
      comments.push(comment);
      const updated = await tx.contentReviewRecord.update({
        where: { id: row.id },
        data: { comments: comments as unknown as Prisma.InputJsonValue },
      });
      return toDetail(updated);
    });
  }

  async create(
    userId: string,
    workspaceId: string | undefined,
    input: CreateContentReviewRecordInput,
  ): Promise<ContentReviewRecordDetail> {
    const workspace = requireWorkspaceId(workspaceId);
    await this.workspacePermissions.requireWorkspaceRole(
      userId,
      workspace,
      WorkspaceMemberRole.editor,
    );

    const existing = await this.prisma.contentReviewRecord.findUnique({
      where: { chargeId: input.chargeId },
    });
    if (existing) {
      if (existing.workspaceId !== workspace || existing.deletedAt) {
        throw new ConflictException({
          code: 'CONTENT_REVIEW_RECORD_EXISTS',
          msg: 'This review has already been saved.',
        });
      }
      return toDetail(existing);
    }

    await this.requireSettledCharge(
      userId,
      workspace,
      input.chargeId,
      input.creditsCharged,
    );
    await this.requireContentReviewAsset(workspace, input.mediaAssetId);

    try {
      const created = await this.prisma.contentReviewRecord.create({
        data: {
          workspaceId: workspace,
          mediaAssetId: input.mediaAssetId,
          chargeId: input.chargeId,
          fileName: input.fileName,
          exportFileName: input.exportFileName,
          durationSeconds: input.durationSeconds,
          creditsCharged: input.creditsCharged,
          findingCount: input.details.length,
          overview: input.overview as Prisma.InputJsonValue,
          details: [...input.details] as Prisma.InputJsonValue,
          comments: [],
          createdByUserId: userId,
        },
      });
      return toDetail(created);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await this.prisma.contentReviewRecord.findUnique({
          where: { chargeId: input.chargeId },
        });
        if (raced && raced.workspaceId === workspace && !raced.deletedAt) {
          return toDetail(raced);
        }
      }
      throw error;
    }
  }

  private async requireSettledCharge(
    userId: string,
    workspaceId: string,
    chargeId: string,
    creditsCharged: number,
  ): Promise<void> {
    const debit = await this.prisma.walletTransaction.findUnique({
      where: { idempotencyKey: debitKey(chargeId) },
      include: { entries: true },
    });
    if (
      !debit ||
      debit.sourceType !== CHARGE_SOURCE ||
      debit.sourceId !== chargeId ||
      debit.workspaceId !== workspaceId ||
      debit.actorUserId !== userId
    ) {
      throw new NotFoundException({
        code: 'CONTENT_REVIEW_CHARGE_NOT_FOUND',
        msg: 'Content-review charge not found.',
      });
    }
    const refunded = await this.prisma.walletTransaction.findUnique({
      where: { idempotencyKey: refundKey(chargeId) },
      select: { id: true },
    });
    if (refunded) {
      throw new ConflictException({
        code: 'CONTENT_REVIEW_CHARGE_RELEASED',
        msg: 'This content-review charge was already released.',
      });
    }
    const billed = creditsFromDebit(debit);
    if (billed !== creditsCharged) {
      throw new BadRequestException({
        code: 'CONTENT_REVIEW_CREDITS_MISMATCH',
        msg: 'Charged credits do not match this review.',
      });
    }
  }

  private async requireContentReviewAsset(
    workspaceId: string,
    mediaAssetId: string,
  ): Promise<void> {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id: mediaAssetId, deletedAt: null },
      select: { workspaceId: true, metadata: true, objectKey: true },
    });
    if (!asset || asset.workspaceId !== workspaceId) {
      throw new NotFoundException({
        code: 'CONTENT_REVIEW_ASSET_NOT_FOUND',
        msg: 'Content-review video not found.',
      });
    }
    if (!isContentReviewVideo(asset)) {
      throw new BadRequestException({
        code: 'CONTENT_REVIEW_ASSET_INVALID',
        msg: 'This media asset is not a content-review video.',
      });
    }
  }
}

function debitKey(chargeId: string) {
  return `${CHARGE_SOURCE}:debit:${chargeId}`;
}

function refundKey(chargeId: string) {
  return `${CHARGE_SOURCE}:refund:${chargeId}`;
}

function requireWorkspaceId(workspaceId: string | undefined | null): string {
  if (!workspaceId?.trim()) {
    throw new BadRequestException({
      code: 'WORKSPACE_REQUIRED',
      msg: 'A workspace is required to store this review.',
    });
  }
  return workspaceId.trim();
}

function isContentReviewVideo(asset: {
  metadata: Prisma.JsonValue;
  objectKey: string | null;
}): boolean {
  const meta =
    asset.metadata &&
    typeof asset.metadata === 'object' &&
    !Array.isArray(asset.metadata)
      ? (asset.metadata as { uploadKind?: unknown })
      : null;
  if (meta?.uploadKind === 'content_review_video') return true;
  return asset.objectKey?.includes('/content-review-video/') === true;
}

function creditsFromDebit(debit: {
  entries: Array<{ amount: bigint }>;
  metadata: unknown;
}): number {
  const meta =
    debit.metadata && typeof debit.metadata === 'object'
      ? (debit.metadata as { credits?: unknown })
      : null;
  if (typeof meta?.credits === 'number' && Number.isFinite(meta.credits)) {
    return meta.credits;
  }
  return Number(debit.entries[0]?.amount ?? 0n);
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function overviewFields(overview: Prisma.JsonValue): {
  suggestion: string | null;
  riskLevel: string | null;
} {
  const record =
    overview && typeof overview === 'object' && !Array.isArray(overview)
      ? (overview as Record<string, unknown>)
      : {};
  return {
    suggestion: stringField(record.aiSuggestion),
    riskLevel: stringField(record.riskLevel),
  };
}

function asRecord(value: Prisma.JsonValue): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asRecordArray(
  value: Prisma.JsonValue,
): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  const records: Array<Record<string, unknown>> = [];
  for (const item of value) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      records.push(item as Record<string, unknown>);
    }
  }
  return records;
}

function toSummary(row: {
  id: string;
  mediaAssetId: string;
  fileName: string;
  durationSeconds: number;
  creditsCharged: number;
  findingCount: number;
  overview: Prisma.JsonValue;
  createdByUserId: string;
  createdAt: Date;
}): ContentReviewRecordSummary {
  const fields = overviewFields(row.overview);
  return {
    id: row.id,
    mediaAssetId: row.mediaAssetId,
    fileName: row.fileName,
    durationSeconds: row.durationSeconds,
    creditsCharged: row.creditsCharged,
    findingCount: row.findingCount,
    suggestion: fields.suggestion,
    riskLevel: fields.riskLevel,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

function parseComments(value: Prisma.JsonValue): ContentReviewComment[] {
  return asRecordArray(value)
    .map((item) => {
      const id = stringField(item.id);
      const body = stringField(item.body);
      const createdByUserId = stringField(item.createdByUserId);
      const createdAt = stringField(item.createdAt);
      const seconds =
        typeof item.seconds === 'number' && Number.isFinite(item.seconds)
          ? item.seconds
          : null;
      if (!id || !body || !createdByUserId || !createdAt || seconds == null) {
        return null;
      }
      return { id, seconds, body, createdByUserId, createdAt };
    })
    .filter((item): item is ContentReviewComment => item !== null);
}

function toDetail(row: {
  id: string;
  mediaAssetId: string;
  fileName: string;
  exportFileName: string;
  durationSeconds: number;
  creditsCharged: number;
  findingCount: number;
  overview: Prisma.JsonValue;
  details: Prisma.JsonValue;
  comments?: Prisma.JsonValue;
  createdByUserId: string;
  createdAt: Date;
}): ContentReviewRecordDetail {
  return {
    ...toSummary(row),
    exportFileName: row.exportFileName,
    overview: asRecord(row.overview),
    details: asRecordArray(row.details),
    comments: parseComments(row.comments ?? []),
  };
}
