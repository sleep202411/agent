import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { PrismaService } from '../infra/db/db.module';
import { storyExperiencePublicationClock } from './story-experience-publication-clock';
import { StoryExperienceReleaseService } from './story-experience-release.service';

const DEFAULT_INTERVAL_MS = 15_000;
const DEFAULT_BATCH_SIZE = 20;
const RECONCILIATION_LEASE_TTL_MS = 60_000;
const MAX_BACKOFF_MS = 5 * 60_000;

@Injectable()
export class StoryExperienceReleaseWorkerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(
    StoryExperienceReleaseWorkerService.name,
  );
  private readonly workerId = `experience-release:${hostname()}:${process.pid}:${randomUUID()}`;
  private timer: NodeJS.Timeout | null = null;
  private draining = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly releases: StoryExperienceReleaseService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.STORY_EXPERIENCE_RELEASE_WORKER_ENABLED === 'false') return;
    const intervalMs = positiveInt(
      process.env.STORY_EXPERIENCE_RELEASE_WORKER_INTERVAL_MS,
      DEFAULT_INTERVAL_MS,
    );
    this.timer = setInterval(() => void this.drainOnce(), intervalMs);
    this.timer.unref?.();
    this.logger.log(
      `Experience release reconciliation worker running every ${intervalMs}ms`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async drainOnce(batch = DEFAULT_BATCH_SIZE): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      const claimed = await this.claim(batch);
      for (const row of claimed) {
        await this.reconcileOne(row);
      }
    } catch (error) {
      this.logger.warn(
        `Experience release reconciliation drain failed: ${errorText(error)}`,
      );
    } finally {
      this.draining = false;
    }
  }

  private async claim(batch: number) {
    const now = await storyExperiencePublicationClock(this.prisma);
    const leaseExpiresAt = new Date(
      now.getTime() + RECONCILIATION_LEASE_TTL_MS,
    );
    const candidates = await this.prisma.storyExperiencePublication.findMany({
      where: {
        OR: [
          {
            status: 'pending',
            attemptCount: { gt: 0 },
            leaseExpiresAt: { lte: now },
          },
          {
            status: 'uncertain',
            nextReconciliationAt: { lte: now },
            AND: [
              {
                OR: [
                  { leaseExpiresAt: null },
                  { leaseExpiresAt: { lte: now } },
                ],
              },
            ],
          },
          {
            status: 'confirmed',
            nextReconciliationAt: { lte: now },
          },
        ],
        AND: [
          {
            OR: [
              { reconciliationLeaseExpiresAt: null },
              { reconciliationLeaseExpiresAt: { lte: now } },
            ],
          },
        ],
      },
      distinct: ['storyProjectId'],
      orderBy: [{ nextReconciliationAt: 'asc' }, { createdAt: 'asc' }],
      take: batch,
      select: {
        id: true,
        storyProjectId: true,
        gameId: true,
        status: true,
      },
    });

    for (const row of candidates) {
      await this.prisma.storyExperiencePublication.updateMany({
        where: {
          id: row.id,
          status: row.status,
          AND: [
            ...(row.status === 'confirmed'
              ? []
              : [
                  {
                    OR: [
                      { leaseExpiresAt: null },
                      { leaseExpiresAt: { lte: now } },
                    ],
                  },
                ]),
            {
              OR: [
                { reconciliationLeaseExpiresAt: null },
                { reconciliationLeaseExpiresAt: { lte: now } },
              ],
            },
          ],
        },
        data: {
          ...(row.status === 'pending'
            ? {
                status: 'uncertain' as const,
                lastErrorCode: 'STORY_EXPERIENCE_PUBLICATION_CRASH_RECOVERY',
                lastErrorDetail:
                  'Recovered a publication whose process stopped before recording the Java outcome.',
                lastErrorAt: now,
                nextReconciliationAt: now,
              }
            : {}),
          reconciliationLeaseOwner: this.workerId,
          reconciliationLeaseAcquiredAt: now,
          reconciliationLeaseExpiresAt: leaseExpiresAt,
          reconciliationAttemptCount: { increment: 1 },
          lastReconciliationAttemptAt: now,
          lastReconciliationErrorCode: null,
          lastReconciliationErrorDetail: null,
          lastReconciliationErrorAt: null,
        },
      });
    }

    return this.prisma.storyExperiencePublication.findMany({
      where: {
        id: { in: candidates.map((row) => row.id) },
        reconciliationLeaseOwner: this.workerId,
      },
      select: {
        id: true,
        storyProjectId: true,
        gameId: true,
        reconciliationAttemptCount: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async reconcileOne(row: {
    id: string;
    storyProjectId: string;
    gameId: string;
    reconciliationAttemptCount: number;
  }): Promise<void> {
    try {
      await this.releases.reconcileProjectCurrent(
        row.storyProjectId,
        row.gameId,
      );
    } catch (error) {
      const now = await storyExperiencePublicationClock(this.prisma);
      const attempt = row.reconciliationAttemptCount;
      await this.prisma.storyExperiencePublication.updateMany({
        where: {
          id: row.id,
          reconciliationLeaseOwner: this.workerId,
          status: { in: ['uncertain', 'confirmed'] },
        },
        data: {
          nextReconciliationAt: new Date(
            now.getTime() + reconciliationBackoffMs(attempt),
          ),
          reconciliationLeaseOwner: null,
          reconciliationLeaseAcquiredAt: null,
          reconciliationLeaseExpiresAt: null,
          lastReconciliationErrorCode: errorCode(error),
          lastReconciliationErrorDetail: errorText(error),
          lastReconciliationErrorAt: now,
        },
      });
      this.logger.warn(
        `Experience release reconciliation failed publication=${row.id} attempt=${attempt}: ${errorText(error)}`,
      );
    }
  }
}

function reconciliationBackoffMs(attempt: number): number {
  return Math.min(5_000 * 2 ** Math.max(0, attempt - 1), MAX_BACKOFF_MS);
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(
      'STORY_EXPERIENCE_RELEASE_WORKER_INTERVAL_MS must be a positive integer.',
    );
  }
  return parsed;
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    4000,
  );
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('getResponse' in error)) {
    return null;
  }
  const getResponse = (error as { getResponse?: unknown }).getResponse;
  if (typeof getResponse !== 'function') return null;
  const response: unknown = getResponse.call(error);
  return response &&
    typeof response === 'object' &&
    'code' in response &&
    typeof (response as { code?: unknown }).code === 'string'
    ? (response as { code: string }).code
    : null;
}
