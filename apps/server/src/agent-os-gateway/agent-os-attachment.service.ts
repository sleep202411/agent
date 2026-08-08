import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ProjectMemberRole } from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import { WorkspacePermissionService } from '../workspaces/workspace-permission.service';

/** Screenplay text files — target 15–20 MiB product ceiling. */
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
/** Character budget for UTF-8 scripts (十几万字 + headroom). */
const MAX_ATTACHMENT_CHARS = 1_000_000;
const DEFAULT_SECTION_SIZE = 4_000;

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
    private readonly workspacePermissions: WorkspacePermissionService,
  ) {}

  async list(
    userId: string,
    projectId: string,
  ): Promise<{ attachments: AgentOsAttachmentSummary[] }> {
    await this.requireProjectRead(userId, projectId);
    const rows = await this.prisma.agentOsAttachment.findMany({
      where: { projectId },
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
  ): Promise<AgentOsAttachmentSummary> {
    await this.requireProjectEdit(userId, projectId);
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

    const filename = sanitizeFilename(file.originalname);
    const mimeType = (file.mimetype || 'application/octet-stream').slice(
      0,
      128,
    );
    const extractable = isTextAttachment(filename, mimeType);

    let status: 'ready' | 'failed' = 'ready';
    let textContent: string | null = null;
    let sections: string[] = [];
    let errorMessage: string | null = null;

    if (!extractable) {
      status = 'failed';
      errorMessage =
        'Only text-based script/document attachments are supported (txt, md, fountain, csv, json, xml).';
    } else {
      try {
        textContent = file.buffer.toString('utf8');
        if (textContent.includes('\uFFFD') && looksBinary(file.buffer)) {
          throw new Error('File is not valid UTF-8 text.');
        }
        if (!textContent.trim()) {
          throw new Error('File has no text content.');
        }
        if (textContent.length > MAX_ATTACHMENT_CHARS) {
          throw new Error(
            `Script text exceeds ${MAX_ATTACHMENT_CHARS} characters; split the file or raise project limits.`,
          );
        }
        sections = splitSections(textContent, DEFAULT_SECTION_SIZE);
      } catch (error) {
        status = 'failed';
        errorMessage =
          error instanceof Error
            ? error.message
            : 'Failed to extract text from attachment.';
        textContent = null;
        sections = [];
      }
    }

    const row = await this.prisma.agentOsAttachment.create({
      data: {
        id: randomUUID(),
        projectId: project.id,
        workspaceId: project.workspaceId,
        uploadedByUserId: userId,
        filename,
        mimeType,
        sizeBytes: file.buffer.length,
        status,
        textContent,
        sections,
        errorMessage,
      },
    });

    return this.toSummary(row);
  }

  async getForTool(
    projectId: string,
    attachmentId: string,
  ): Promise<{
    id: string;
    filename: string;
    sections: string[];
    status: string;
  }> {
    const row = await this.prisma.agentOsAttachment.findFirst({
      where: { id: attachmentId, projectId },
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

  private async requireProjectEdit(userId: string, projectId: string) {
    await this.workspacePermissions.requireProjectRole(
      userId,
      projectId,
      ProjectMemberRole.editor,
    );
  }

  private async requireProjectRead(userId: string, projectId: string) {
    await this.workspacePermissions.requireProjectRole(
      userId,
      projectId,
      ProjectMemberRole.viewer,
    );
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
