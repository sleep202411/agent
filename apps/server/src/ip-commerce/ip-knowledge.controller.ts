import {
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { CurrentUser, Public, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { PrismaService } from '../infra/db/db.module';
import { AgentOsWorkerClient } from '../agent-os-gateway/agent-os-worker.client';
import { IpCommerceService } from './ip-commerce.service';

export const PublishedDocumentItemSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().trim().min(1).max(240),
    content: z.string().trim().min(1).max(20000),
    isPublished: z.boolean().default(true),
    updatedAt: z.string(),
  })
  .strict();

export type PublishedDocumentItem = z.infer<typeof PublishedDocumentItemSchema>;

const UpdateKnowledgeDocsSchema = z
  .object({
    documents: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            title: z.string().trim().min(1).max(240),
            content: z.string().trim().min(1).max(20000),
            isPublished: z.boolean(),
          })
          .strict(),
      )
      .max(50),
    expectedVersion: z.number().int().min(0),
  })
  .strict();

const AskKnowledgeSchema = z
  .object({
    question: z.string().trim().min(1).max(1000),
    locale: z.enum(['en-US', 'zh-CN', 'zh-HK']),
  })
  .strict();

const Params = z.object({ ipId: z.string().uuid() });

@Injectable()
export class IpKnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ips: IpCommerceService,
    private readonly modules: ModuleRef,
  ) {}

  private async readRaw(
    ipId: string,
  ): Promise<{ documents: PublishedDocumentItem[]; version: number }> {
    const [row] = await this.prisma.$queryRaw<
      { audience_documents: PublishedDocumentItem[] | null; version: number }[]
    >`SELECT audience_documents, version FROM ips WHERE id = ${ipId}::uuid AND deleted_at IS NULL`;
    if (!row) {
      throw new NotFoundException({
        code: 'IP_NOT_FOUND',
        message: 'Film not found.',
      });
    }
    return {
      documents: row.audience_documents ?? [],
      version: row.version,
    };
  }

  async getAdminDocuments(user: AuthUser, ipId: string) {
    await this.ips.requireEditableIp(user, ipId);
    return this.readRaw(ipId);
  }

  async updateAdminDocuments(
    user: AuthUser,
    ipId: string,
    input: z.infer<typeof UpdateKnowledgeDocsSchema>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ip:knowledge:${ipId}`})::bigint)`;
      await tx.$queryRaw`SELECT id FROM ips WHERE id = ${ipId}::uuid FOR UPDATE`;
      await this.ips.requireEditableIp(user, ipId, tx);

      const now = new Date().toISOString();
      const updatedDocs: PublishedDocumentItem[] = input.documents.map((d) => ({
        ...d,
        updatedAt: now,
      }));

      const rows = await tx.$queryRaw<
        { audience_documents: PublishedDocumentItem[]; version: number }[]
      >`
        UPDATE ips SET audience_documents = ${JSON.stringify(updatedDocs)}::jsonb, version = version + 1, updated_at = now(), updated_by_id = ${user.userId}
        WHERE id = ${ipId}::uuid AND version = ${input.expectedVersion}
        RETURNING audience_documents, version
      `;
      if (!rows[0]) {
        throw new ConflictException({
          code: 'IP_VERSION_CONFLICT',
          message: 'This film was updated elsewhere. Refresh and try again.',
        });
      }
      return {
        documents: rows[0].audience_documents ?? [],
        version: rows[0].version,
      };
    });
  }

  async getPublishedAudienceDocuments(ipId: string, user?: AuthUser) {
    await this.ips.ensurePublicEngagementTarget(user, ipId);
    const { documents } = await this.readRaw(ipId);
    return {
      documents: documents.filter((d) => d.isPublished),
    };
  }

  async askKnowledge(
    user: AuthUser,
    ipId: string,
    input: z.infer<typeof AskKnowledgeSchema>,
    signal: AbortSignal,
  ) {
    await this.ips.ensurePublicEngagementTarget(user, ipId);
    const ip = await this.ips.getPublicIp(ipId, user);
    if (!ip) {
      throw new NotFoundException({
        code: 'IP_NOT_FOUND',
        message: 'Film not found.',
      });
    }

    const { documents } = await this.readRaw(ipId);
    const published = documents.filter((d) => d.isPublished);

    signal.throwIfAborted();
    // No model or worker is needed to report that no public source exists.
    // Keep the same audience access check used by the answered path.
    if (published.length === 0) {
      await this.ips.ensurePublicEngagementTarget(user, ipId);
      signal.throwIfAborted();
      return {
        answer:
          input.locale === 'zh-CN'
            ? '目前没有关于该影片的已发布公开资料，暂时无法回答您的问题。'
            : input.locale === 'zh-HK'
              ? '目前沒有關於該影片的已發佈公開資料，暫時無法回答您的問題。'
              : 'There are currently no published materials available for this film to answer your question.',
        citedDocumentIds: [],
        unanswered: true,
      };
    }

    let worker: AgentOsWorkerClient;
    try {
      worker = this.modules.get(AgentOsWorkerClient, { strict: false });
    } catch {
      throw new ServiceUnavailableException(
        'Knowledge assistance is not configured.',
      );
    }

    const sources = published.slice(0, 20).map((d) => ({
      documentId: d.id,
      title: d.title,
      snippet: d.content.slice(0, 4000),
    }));

    const response = await worker.answerFilmKnowledge(
      {
        ipId,
        ipTitle: ip.ip.title,
        question: input.question,
        locale: input.locale,
        sources,
      },
      signal,
    );

    signal.throwIfAborted();
    // Re-verify audience access and the actual source snapshots. A creator may
    // withdraw or correct material while the provider is generating its answer.
    await this.ips.ensurePublicEngagementTarget(user, ipId);
    const current = await this.readRaw(ipId);
    const available = new Map(
      current.documents.filter((d) => d.isPublished).map((d) => [d.id, d]),
    );
    if (
      sources.some((source) => {
        const document = available.get(source.documentId);
        return (
          !document ||
          document.title !== source.title ||
          document.content.slice(0, 4000) !== source.snippet
        );
      })
    ) {
      throw new ConflictException({
        code: 'KNOWLEDGE_SOURCES_CHANGED',
        message:
          'Published film materials changed during your request. Please ask again.',
      });
    }
    signal.throwIfAborted();
    return response;
  }
}

@Controller('ip-commerce')
export class IpKnowledgeController {
  constructor(private readonly service: IpKnowledgeService) {}

  @Get('me/ips/:ipId/knowledge-documents')
  async getAdminDocs(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(Params)) params: z.infer<typeof Params>,
  ) {
    return {
      code: 200,
      data: await this.service.getAdminDocuments(user, params.ipId),
    };
  }

  @Put('me/ips/:ipId/knowledge-documents')
  async updateAdminDocs(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(Params)) params: z.infer<typeof Params>,
    @Body(new ZodValidationPipe(UpdateKnowledgeDocsSchema))
    input: z.infer<typeof UpdateKnowledgeDocsSchema>,
  ) {
    return {
      code: 200,
      data: await this.service.updateAdminDocuments(user, params.ipId, input),
    };
  }

  @Public()
  @Get('ips/:ipId/knowledge-documents')
  async getPublicDocs(
    @Param(new ZodValidationPipe(Params)) params: z.infer<typeof Params>,
    @CurrentUser() user?: AuthUser,
  ) {
    return {
      code: 200,
      data: await this.service.getPublishedAudienceDocuments(params.ipId, user),
    };
  }

  @Post('ips/:ipId/knowledge/ask')
  @Header('Cache-Control', 'private, no-store')
  async ask(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(Params)) params: z.infer<typeof Params>,
    @Body(new ZodValidationPipe(AskKnowledgeSchema))
    input: z.infer<typeof AskKnowledgeSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    void req;
    const controller = new AbortController();
    const stop = () => controller.abort();
    res.once('close', stop);
    const timeout = setTimeout(stop, 45_000);

    try {
      const data = await this.service.askKnowledge(
        user,
        params.ipId,
        input,
        controller.signal,
      );
      return { code: 200, data };
    } finally {
      clearTimeout(timeout);
      res.off('close', stop);
    }
  }
}
