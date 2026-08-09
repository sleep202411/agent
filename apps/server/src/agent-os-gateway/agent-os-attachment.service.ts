import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AgentProjectKind } from '@repo/agent-capabilities';
import { PrismaService } from '../infra/db/db.module';
import {
  AgentOsProjectContextService,
  type AgentOsProjectContext,
} from './agent-os-project-context.service';

/** Screenplay text files — target 15–20 MiB product ceiling. */
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
/** Character budget for UTF-8 scripts (十几万字 + headroom). */
const MAX_ATTACHMENT_CHARS = 1_000_000;
const DEFAULT_SECTION_SIZE = 4_000;
export const MAX_AGENT_OS_ATTACHMENTS_PER_RUN = 20;

const TEXT_MIME = new Set([
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'text/csv',
  'application/json',
  'application/xml',
  'text/xml',
]);

const TEXT_EXT = /\.(txt|md|markdown|fountain|fdx|csv|json|xml|log)$/i;

export type AgentOsAttachmentSummary = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: 'ready' | 'failed';
  sectionCount: number;
  errorMessage?: string | null;
  createdAt: string;
};

/**
 * Project-scoped file attachments for Agent OS.
 * Product path: browser uploads a file → tools read by attachmentId.
 */
@Injectable()
export class AgentOsAttachmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: AgentOsProjectContextService,
  ) {}

  async list(
    userId: string,
    projectId: string,
  ): Promise<{ attachments: AgentOsAttachmentSummary[] }> {
    const project = await this.projects.requireRead(userId, projectId);
    const rows = await this.prisma.agentOsAttachment.findMany({
      where: attachmentScopeWhere(project),
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return {
      attachments: rows.map((row) => this.toSummary(row)),
    };
  }

  async upload(
    userId: string,
    projectId: string,
    file: {
      originalname: string;
      mimetype: string;
      size: number;
      buffer: Buffer;
    },
    options?: { sectionSize?: number },
  ): Promise<AgentOsAttachmentSummary> {
    const project = await this.projects.requireWrite(userId, projectId);
    if (!file?.buffer?.length) {
      throw new BadRequestException({
        code: 'AGENT_OS_ATTACHMENT_EMPTY',
        message: 'Uploaded file is empty.',
      });
    }
    if (
      file.size > MAX_ATTACHMENT_BYTES ||
      file.buffer.length > MAX_ATTACHMENT_BYTES
    ) {
      throw new BadRequestException({
        code: 'AGENT_OS_ATTACHMENT_TOO_LARGE',
        message: `Attachment must be at most ${MAX_ATTACHMENT_BYTES} bytes.`,
      });
    }

    const filename = sanitizeFilename(file.originalname);
    const mimeType = normalizeMimeType(file.mimetype);
    const extractable = isTextAttachment(filename, mimeType);

    if (!extractable) {
      throw new UnprocessableEntityException({
        code: 'AGENT_OS_ATTACHMENT_UNSUPPORTED_TYPE',
        message:
          'Only UTF-8 text documents are supported: txt, md, markdown, fountain, fdx, csv, json, xml, and log.',
      });
    }

    const textContent = file.buffer.toString('utf8');
    if (textContent.includes('\uFFFD') && looksBinary(file.buffer)) {
      throw new UnprocessableEntityException({
        code: 'AGENT_OS_ATTACHMENT_INVALID_UTF8',
        message: 'The attachment is not valid UTF-8 text.',
      });
    }
    if (!textContent.trim()) {
      throw new UnprocessableEntityException({
        code: 'AGENT_OS_ATTACHMENT_NO_TEXT',
        message: 'The attachment has no text content.',
      });
    }
    if (textContent.length > MAX_ATTACHMENT_CHARS) {
      throw new UnprocessableEntityException({
        code: 'AGENT_OS_ATTACHMENT_TEXT_TOO_LARGE',
        message: `Attachment text must be at most ${MAX_ATTACHMENT_CHARS} characters.`,
      });
    }
    const sectionSize = options?.sectionSize ?? DEFAULT_SECTION_SIZE;
    const sections = splitSections(textContent, sectionSize);

    const row = await this.prisma.agentOsAttachment.create({
      data: {
        id: randomUUID(),
        projectKind: project.projectKind,
        platformProjectId:
          project.projectKind === 'platform' ? project.projectId : null,
        storyProjectId:
          project.projectKind === 'story' ? project.projectId : null,
        workspaceId: project.workspaceId,
        uploadedByUserId: userId,
        filename,
        mimeType,
        sizeBytes: file.buffer.length,
        status: 'ready',
        textContent,
        sections,
        errorMessage: null,
      },
    });

    return this.toSummary(row);
  }

  async getForTool(
    projectKind: AgentProjectKind,
    projectId: string,
    attachmentId: string,
  ): Promise<{
    id: string;
    filename: string;
    sections: string[];
    status: string;
  }> {
    const row = await this.prisma.agentOsAttachment.findFirst({
      where: {
        id: attachmentId,
        ...attachmentIdentityWhere(projectKind, projectId),
      },
    });
    if (!row) {
      throw new NotFoundException({
        code: 'ATTACHMENT_NOT_FOUND',
        message: `Attachment ${attachmentId} not found on this project.`,
      });
    }
    if (row.status !== 'ready') {
      throw new UnprocessableEntityException({
        code: 'ATTACHMENT_NOT_READY',
        message: row.errorMessage ?? 'Attachment is not ready for reading.',
      });
    }
    return {
      id: row.id,
      filename: row.filename,
      sections: parseStringArray(row.sections),
      status: row.status,
    };
  }

  /**
   * Fail before a run reaches the worker when a caller references an attachment
   * from another project, a deleted project, or an incomplete ingestion.
   * The returned ids are de-duplicated in the caller's original order.
   */
  async validateForRun(
    projectKind: AgentProjectKind,
    projectId: string,
    attachmentIds: readonly string[] | undefined,
  ): Promise<string[] | undefined> {
    if (!attachmentIds?.length) return undefined;
    const uniqueIds = [...new Set(attachmentIds)];
    if (uniqueIds.length > MAX_AGENT_OS_ATTACHMENTS_PER_RUN) {
      throw new BadRequestException({
        code: 'AGENT_OS_TOO_MANY_ATTACHMENTS',
        message: `A turn can include at most ${MAX_AGENT_OS_ATTACHMENTS_PER_RUN} attachments.`,
      });
    }
    const rows = await this.prisma.agentOsAttachment.findMany({
      where: {
        id: { in: uniqueIds },
        ...attachmentIdentityWhere(projectKind, projectId),
      },
      select: { id: true, status: true, errorMessage: true },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const missingId = uniqueIds.find((id) => !byId.has(id));
    if (missingId) {
      throw new NotFoundException({
        code: 'ATTACHMENT_NOT_FOUND',
        message: `Attachment ${missingId} was not found on this project.`,
      });
    }
    const unavailable = uniqueIds
      .map((id) => byId.get(id))
      .find((row) => row?.status !== 'ready');
    if (unavailable) {
      throw new UnprocessableEntityException({
        code: 'ATTACHMENT_NOT_READY',
        message:
          unavailable.errorMessage ??
          `Attachment ${unavailable.id} is not ready for reading.`,
      });
    }
    return uniqueIds;
  }

  private toSummary(row: {
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    status: string;
    sections: unknown;
    errorMessage: string | null;
    createdAt: Date;
  }): AgentOsAttachmentSummary {
    return {
      id: row.id,
      filename: row.filename,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      status: row.status === 'ready' ? 'ready' : 'failed',
      sectionCount: parseStringArray(row.sections as never).length,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

export function splitSections(text: string, sectionSize: number): string[] {
  const sections: string[] = [];
  for (let i = 0; i < text.length; i += sectionSize) {
    sections.push(text.slice(i, i + sectionSize));
  }
  return sections.length > 0 ? sections : [''];
}

export function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function sanitizeFilename(name: string): string {
  const base = name.replace(/[/\\]/g, '_').trim() || 'attachment.txt';
  return base.slice(0, 500);
}

function normalizeMimeType(value: string): string {
  return (value || 'application/octet-stream')
    .split(';', 1)[0]
    .trim()
    .toLowerCase()
    .slice(0, 128);
}

function isTextAttachment(filename: string, mimeType: string): boolean {
  if (TEXT_MIME.has(mimeType.toLowerCase())) return true;
  if (mimeType.startsWith('text/')) return true;
  return TEXT_EXT.test(filename);
}

function looksBinary(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 800));
  let weird = 0;
  for (const b of sample) {
    if (b === 0) return true;
    if (b < 7 || (b > 13 && b < 32)) weird += 1;
  }
  return weird / sample.length > 0.3;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function attachmentIdentityWhere(
  projectKind: AgentProjectKind,
  projectId: string,
): Prisma.AgentOsAttachmentWhereInput {
  return projectKind === 'platform'
    ? {
        projectKind,
        platformProjectId: projectId,
        storyProjectId: null,
      }
    : {
        projectKind,
        storyProjectId: projectId,
        platformProjectId: null,
      };
}

function attachmentScopeWhere(
  project: AgentOsProjectContext,
): Prisma.AgentOsAttachmentWhereInput {
  return attachmentIdentityWhere(project.projectKind, project.projectId);
}
