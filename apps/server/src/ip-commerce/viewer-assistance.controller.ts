import {
  Body,
  Controller,
  Header,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { AgentOsWorkerClient } from '../agent-os-gateway/agent-os-worker.client';
import { IpCommerceService } from './ip-commerce.service';
import { ListIpsQuerySchema } from './dto';
const inputSchema = z
  .object({
    preference: z.string().trim().min(1).max(1000),
    locale: z.enum(['en-US', 'zh-CN', 'zh-HK']),
  })
  .strict();
@Controller('viewer-assistance')
export class ViewerAssistanceController {
  constructor(
    private readonly ips: IpCommerceService,
    private readonly modules: ModuleRef,
  ) {}
  @Post()
  @Header('Cache-Control', 'private, no-store')
  async recommend(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(inputSchema))
    input: z.infer<typeof inputSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    void req;
    let worker: AgentOsWorkerClient;
    try {
      worker = this.modules.get(AgentOsWorkerClient, { strict: false });
    } catch {
      throw new ServiceUnavailableException(
        'Viewing assistance is not configured.',
      );
    }
    const controller = new AbortController();
    const stop = () => controller.abort();
    res.once('close', stop);
    const timeout = setTimeout(stop, 40_000);
    try {
      const query = ListIpsQuerySchema.parse({
        locale: input.locale,
        limit: 20,
      });
      const catalog = await this.ips.listPublicIps(query, user);
      controller.signal.throwIfAborted();
      const candidates = catalog.items.filter(hasPreview).map((row) => ({
        id: row.id,
        title: row.title.slice(0, 240),
        summary: row.summary.slice(0, 1500),
      }));
      if (!candidates.length) return { code: 200, data: { suggestions: [] } };
      const reply = await worker.recommendViewing(
        { ...input, candidates },
        controller.signal,
      );
      controller.signal.throwIfAborted();
      const allowed = new Set(candidates.map((row) => row.id));
      if (reply.suggestions.some((row) => !allowed.has(row.id)))
        throw new ServiceUnavailableException(
          'Invalid viewing recommendation.',
        );
      // Re-evaluate public visibility and viewer blocks after the model wait.
      const refreshed = await this.ips.listPublicIps(query, user);
      controller.signal.throwIfAborted();
      const current = new Map(
        refreshed.items.filter(hasPreview).map((row) => [row.id, row]),
      );
      return {
        code: 200,
        data: {
          suggestions: reply.suggestions.flatMap((row) => {
            const ip = current.get(row.id);
            return ip
              ? [{ id: ip.id, title: ip.title, reason: row.reason }]
              : [];
          }),
        },
      };
    } finally {
      clearTimeout(timeout);
      res.off('close', stop);
    }
  }
}

function hasPreview(
  ip: Awaited<ReturnType<IpCommerceService['listPublicIps']>>['items'][number],
) {
  return [
    ip.trailerAsset,
    ...ip.episodes.flatMap((row) => [row.trailerAsset, row.mediaAsset]),
  ].some((asset) => asset?.kind === 'video' && Boolean(asset.url));
}
