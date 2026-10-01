import { ContentGpsGeocodingService } from './content-gps-geocoding';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  Res,
  Get,
  NotFoundException,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/auth.decorator';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../infra/db/db.module';
import { AgentOsWorkerClient } from '../agent-os-gateway/agent-os-worker.client';
import { ContentGpsAnalysisService } from './content-gps-analysis';
import {
  ContentGpsSourcesService,
  gpsSnapshotFingerprint,
} from './content-gps-sources';
import { ContentGpsLocationsService } from './content-gps-locations';

export const GpsDispatchInput = z
  .object({
    requestId: z.string().uuid(),
    locale: z.enum(['en-US', 'zh-CN', 'zh-HK']),
  })
  .strict();
const Limits = z.object({
  version: z.string().trim().min(1).max(200),
  daily: z.coerce.number().int().min(1).max(100000),
  concurrent: z.coerce.number().int().min(1).max(100),
});
type DispatchRow = {
  id: string;
  ipId: string;
  locale: string;
  sourceFingerprint: string;
  analysisVersion: string;
  status: string;
};

/** Explicit owner-triggered orchestration; no scheduler/backfill. Reservation is
 * durable before invoking a paid worker. Unknown outcomes never auto-redispatch. */
@Injectable()
export class ContentGpsDispatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sources: ContentGpsSourcesService,
    private readonly analyses: ContentGpsAnalysisService,
    private readonly owners: ContentGpsLocationsService,
    private readonly modules: ModuleRef,
    private readonly geocoding: ContentGpsGeocodingService,
  ) {}

  async receipt(ipId: string, user: AuthUser, requestId: string) {
    z.string().uuid().parse(requestId);
    await this.owners.read(ipId, user);
    const [row] = await this.prisma.$queryRaw<
      {
        id: string;
        status: string;
        sourceFingerprint: string;
        analysisVersion: string;
        createdAt: Date;
        finishedAt: Date | null;
      }[]
    >`SELECT request.request_id AS id, COALESCE(dispatch.status, 'cached') AS status,
      request.source_fingerprint AS "sourceFingerprint", request.analysis_version AS "analysisVersion",
      request.created_at AS "createdAt", dispatch.finished_at AS "finishedAt"
      FROM ip_content_gps_analysis_requests request LEFT JOIN ip_content_gps_dispatches dispatch ON dispatch.id = request.dispatch_id
      WHERE request.ip_id = ${ipId}::uuid AND request.actor_id = ${user.userId} AND request.request_id = ${requestId}::uuid`;
    if (!row) throw new NotFoundException('Analysis request not found.');
    await this.owners.read(ipId, user);
    return row;
  }

  async run(
    ipId: string,
    user: AuthUser,
    raw: z.infer<typeof GpsDispatchInput>,
    signal: AbortSignal,
  ) {
    const input = GpsDispatchInput.parse(raw);
    await this.owners.read(ipId, user);
    signal.throwIfAborted();
    if (process.env.CONTENT_GPS_ANALYSIS_ENABLED !== 'true')
      throw new ServiceUnavailableException(
        'Content GPS analysis is not enabled.',
      );
    const parsed = Limits.safeParse({
      version: process.env.CONTENT_GPS_ANALYSIS_VERSION,
      daily: process.env.CONTENT_GPS_ANALYSIS_DAILY_LIMIT,
      concurrent: process.env.CONTENT_GPS_ANALYSIS_MAX_IN_FLIGHT,
    });
    if (!parsed.success)
      throw new ServiceUnavailableException(
        'Content GPS analysis version and quota limits must be configured.',
      );
    const limits = parsed.data;
    let worker: AgentOsWorkerClient;
    try {
      worker = this.modules.get(AgentOsWorkerClient, { strict: false });
    } catch {
      throw new ServiceUnavailableException(
        'Content GPS worker is not configured.',
      );
    }
    const snapshot = await this.sources.snapshot(
      ipId,
      input.locale,
      limits.version,
    );
    const fingerprint = gpsSnapshotFingerprint(snapshot);
    const current = await this.analyses.current(
      ipId,
      input.locale,
      limits.version,
    );
    signal.throwIfAborted();
    // Check request identity before returning any cached result or spending quota.
    const claim = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('content-gps:dispatch:quota')::bigint)`;
      const [prior] = await tx.$queryRaw<DispatchRow[]>`
        SELECT dispatch_id AS id, ip_id AS "ipId", locale, source_fingerprint AS "sourceFingerprint", analysis_version AS "analysisVersion"
        FROM ip_content_gps_analysis_requests WHERE actor_id = ${user.userId} AND request_id = ${input.requestId}::uuid`;
      if (
        prior &&
        (prior.ipId !== ipId ||
          prior.locale !== input.locale ||
          prior.sourceFingerprint !== fingerprint ||
          prior.analysisVersion !== limits.version)
      )
        throw new ConflictException(
          'This analysis request belongs to different or changed source content.',
        );
      const [same] = await tx.$queryRaw<DispatchRow[]>`
        SELECT id, status FROM ip_content_gps_dispatches WHERE ip_id = ${ipId}::uuid AND locale = ${input.locale}
        AND source_fingerprint = ${fingerprint} AND analysis_version = ${limits.version}`;
      const bind = async (id: string | null) => {
        await tx.$executeRaw`INSERT INTO ip_content_gps_analysis_requests
          (actor_id, request_id, ip_id, locale, source_fingerprint, analysis_version, dispatch_id)
          VALUES (${user.userId}, ${input.requestId}::uuid, ${ipId}::uuid, ${input.locale}, ${fingerprint}, ${limits.version}, ${id}::uuid)
          ON CONFLICT DO NOTHING`;
      };
      if (current.analysis && current.sourceFingerprint === fingerprint) {
        await bind(same?.id ?? null);
        if (same)
          await tx.$executeRaw`UPDATE ip_content_gps_dispatches SET status = 'succeeded', finished_at = COALESCE(finished_at, now()) WHERE id = ${same.id}::uuid`;
        return { id: same?.id ?? null, invoke: false, pending: false };
      }
      if (prior || same) {
        await bind(same?.id ?? null);
        return { id: same?.id ?? null, invoke: false, pending: true };
      }
      const [counts] = await tx.$queryRaw<
        { daily: bigint; concurrent: bigint }[]
      >`
        SELECT
          (SELECT count(*) FROM ip_content_gps_dispatches WHERE created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')) AS daily,
          (SELECT count(*) FROM ip_content_gps_dispatches WHERE status IN ('dispatched', 'uncertain')) AS concurrent`;
      if (
        counts.daily >= BigInt(limits.daily) ||
        counts.concurrent >= BigInt(limits.concurrent)
      )
        throw new ServiceUnavailableException(
          'Content GPS analysis quota or concurrency limit reached.',
        );
      // Verify the public snapshot and owner again just before reservation.
      const fresh = await this.sources.snapshotIn(
        tx,
        ipId,
        input.locale,
        limits.version,
      );
      if (gpsSnapshotFingerprint(fresh) !== fingerprint)
        throw new ConflictException('IP source text changed before dispatch.');
      const [ip] = await tx.$queryRaw<
        { owner: string }[]
      >`SELECT created_by_id AS owner FROM ips WHERE id = ${ipId}::uuid AND deleted_at IS NULL FOR SHARE`;
      if (ip?.owner !== user.userId)
        throw new ConflictException('IP ownership changed before dispatch.');
      signal.throwIfAborted();
      const id = randomUUID();
      await tx.$executeRaw`INSERT INTO ip_content_gps_dispatches (id, ip_id, actor_id, request_id, locale, source_fingerprint, analysis_version)
        VALUES (${id}::uuid, ${ipId}::uuid, ${user.userId}, ${input.requestId}::uuid, ${input.locale}, ${fingerprint}, ${limits.version})`;
      await bind(id);
      return { id, invoke: true, pending: false };
    });
    if (claim.pending)
      throw new ConflictException(
        'Analysis is already dispatched or has an uncertain outcome. Reconcile the existing attempt before another paid call.',
      );
    if (!claim.invoke) {
      await this.geocoding.enrich(
        ipId,
        input.locale,
        limits.version,
        user,
        signal,
      );
      await this.owners.read(ipId, user);
      signal.throwIfAborted();
      return this.analyses.current(ipId, input.locale, limits.version);
    }
    try {
      signal.throwIfAborted();
      const output = await worker.extractContentGps(snapshot, signal);
      signal.throwIfAborted();
      await this.owners.read(ipId, user);
      await this.analyses.save(snapshot, output);
      await this.geocoding.enrich(
        ipId,
        input.locale,
        limits.version,
        user,
        signal,
      );
      await this.prisma
        .$executeRaw`UPDATE ip_content_gps_dispatches SET status = 'succeeded', finished_at = now() WHERE id = ${claim.id}::uuid`;
      await this.owners.read(ipId, user);
      signal.throwIfAborted();
      return this.analyses.current(ipId, input.locale, limits.version);
    } catch (error) {
      // Even HTTP/model errors can follow paid provider work. Keep a durable
      // uncertain receipt; do not resend. A saved analysis can still be recovered.
      await this.prisma
        .$executeRaw`UPDATE ip_content_gps_dispatches SET status = 'uncertain', finished_at = now() WHERE id = ${claim.id}::uuid AND status = 'dispatched'`.catch(
        () => undefined,
      );
      throw error;
    }
  }
}

@Controller('ip-commerce/me/ips/:ipId/content-gps')
export class ContentGpsDispatchController {
  constructor(private readonly dispatch: ContentGpsDispatchService) {}

  @Get('analysis/:requestId')
  async receipt(
    @Param(
      new ZodValidationPipe(
        z.object({ ipId: z.string().uuid(), requestId: z.string().uuid() }),
      ),
    )
    params: { ipId: string; requestId: string },
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      data: await this.dispatch.receipt(params.ipId, user, params.requestId),
    };
  }

  @Post('analyze')
  @HttpCode(200)
  async run(
    @Param(new ZodValidationPipe(z.object({ ipId: z.string().uuid() })))
    params: { ipId: string },
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(GpsDispatchInput))
    input: z.infer<typeof GpsDispatchInput>,
    @Res({ passthrough: true }) response: Response,
  ) {
    const controller = new AbortController();
    const disconnect = () => controller.abort();
    response.once('close', disconnect);
    try {
      return {
        code: 200,
        data: await this.dispatch.run(
          params.ipId,
          user,
          input,
          AbortSignal.any([controller.signal, AbortSignal.timeout(50_000)]),
        ),
      };
    } finally {
      response.off('close', disconnect);
    }
  }
}
