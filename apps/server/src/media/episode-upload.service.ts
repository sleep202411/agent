import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { EpisodeUpload } from '@prisma/client';
import {
  EPISODE_UPLOAD_PART_BYTES,
  type EpisodeUploadSession,
} from '@repo/shared';
import { PrismaService } from '../infra/db/db.module';
import { backgroundTasksEnabled } from '../common/background-tasks';
import { StorageProviderRegistry } from '../infra/storage/storage-provider-registry.service';
import type {
  MultipartUploadRef,
  StoredUploadPart,
} from '../infra/storage/storage.types';
import type { UploadKind } from './dto';
import { MediaUploadService } from './media-upload.service';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const OPERATION_LEASE_MS = 5 * 60 * 1000;

export type MultipartUploadKind =
  | 'episode_source_video'
  | 'content_review_video';

export interface StartEpisodeUpload {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  kind?: MultipartUploadKind;
}

const MULTIPART_KIND_BY_SEGMENT: Record<string, MultipartUploadKind> = {
  'episode-source-video': 'episode_source_video',
  'content-review-video': 'content_review_video',
};

function kindFromStorageKey(storageKey: string): UploadKind {
  const segment = storageKey.split('/')[2];
  return MULTIPART_KIND_BY_SEGMENT[segment ?? ''] ?? 'episode_source_video';
}

/** Only metadata lives here. Parts and bytes go directly to object storage. */
@Injectable()
export class EpisodeUploadService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EpisodeUploadService.name);
  private timer?: ReturnType<typeof setInterval>;
  private sweeping: Promise<void> | null = null;
  private stopping = false;
  private cleanupCursor: string | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: MediaUploadService,
    private readonly registry: StorageProviderRegistry,
  ) {}

  onModuleInit() {
    if (!backgroundTasksEnabled()) return;
    if (this.stopping || this.timer) return;
    this.timer = setInterval(() => void this.sweepExpired(), 60_000);
    this.timer.unref();
  }

  async onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.sweeping;
  }

  async start(
    userId: string,
    input: StartEpisodeUpload,
    workspaceId?: string,
  ): Promise<EpisodeUploadSession> {
    const prepared = await this.uploads.prepareUpload(
      userId,
      {
        ...input,
        kind: input.kind ?? 'episode_source_video',
      },
      workspaceId,
    );
    const session = await this.prisma.episodeUpload.upsert({
      where: { id: input.id },
      update: {},
      create: {
        id: input.id,
        userId,
        workspaceId: prepared.workspaceId,
        fileName: input.fileName,
        contentType: input.contentType,
        sizeBytes: BigInt(input.sizeBytes),
        partSize: EPISODE_UPLOAD_PART_BYTES,
        provider: prepared.storage.providerId,
        storageKey: prepared.storageKey,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    this.assertOwner(session, userId, prepared.workspaceId);
    if (
      session.fileName !== input.fileName ||
      session.contentType !== input.contentType ||
      session.sizeBytes !== BigInt(input.sizeBytes)
    ) {
      throw new ConflictException('Upload session belongs to a different file');
    }
    this.assertActive(session);
    if (session.status === 'initializing') {
      await this.withLease(session.id, async (current) => {
        if (current.status !== 'initializing') return;
        const storage = this.storage(current);
        const ref = await storage.beginMultipartUpload(
          current.storageKey,
          current.contentType,
        );
        try {
          await this.prisma.episodeUpload.update({
            where: { id: current.id },
            data: {
              uploadId: ref.uploadId,
              bucket: ref.bucket,
              region: ref.region,
              status: 'uploading',
            },
          });
        } catch (error) {
          await storage.abortMultipartUpload(ref).catch(() => undefined);
          throw error;
        }
      });
    }
    return this.status(userId, session.id, workspaceId);
  }

  async status(
    userId: string,
    id: string,
    workspaceId?: string,
  ): Promise<EpisodeUploadSession> {
    const session = await this.owned(userId, id, workspaceId);
    let uploaded =
      session.status === 'uploaded' || session.status === 'completed';
    let parts: StoredUploadPart[] = [];
    if (!uploaded && session.status === 'uploading') {
      const storage = this.storage(session);
      const ref = this.ref(session);
      try {
        parts = await storage.listUploadParts(ref);
      } catch (error) {
        // Storage may have merged successfully just before the process stopped.
        // Reopening the dialog must reach complete(), which recovers that state.
        const head = await storage.headStoredObject(ref);
        if (
          !head.exists ||
          head.sizeBytes !== Number(session.sizeBytes) ||
          head.contentType !== session.contentType
        )
          throw error;
        uploaded = true;
      }
    }
    return {
      id,
      partSize: session.partSize,
      sizeBytes: Number(session.sizeBytes),
      expiresAt: session.expiresAt.toISOString(),
      uploaded,
      parts: parts.map(({ number, sizeBytes }) => ({ number, sizeBytes })),
    };
  }

  async signPart(
    userId: string,
    id: string,
    number: number,
    workspaceId?: string,
  ) {
    const session = await this.owned(userId, id, workspaceId);
    if (session.status !== 'uploading')
      throw new ConflictException('Upload is not accepting parts');
    if (
      !Number.isInteger(number) ||
      number < 1 ||
      number > Math.ceil(Number(session.sizeBytes) / session.partSize)
    ) {
      throw new BadRequestException('Invalid upload part number');
    }
    return this.storage(session).signUploadPart(this.ref(session), number);
  }

  async complete(userId: string, id: string, workspaceId?: string) {
    await this.owned(userId, id, workspaceId);
    return this.withLease(id, async (session) => {
      this.assertActive(session);
      const storage = this.storage(session);
      const ref = this.ref(session);
      if (session.status === 'uploading') {
        // A prior complete can have succeeded at storage while its response was
        // lost. HEAD the unique final key before asking for the now-gone parts.
        const before = await storage.headStoredObject(ref);
        if (!before.exists || before.sizeBytes === 0) {
          const parts = await storage.listUploadParts(ref);
          validateEpisodeParts(
            parts,
            Number(session.sizeBytes),
            session.partSize,
          );
          await storage.completeMultipartUpload(
            ref,
            parts,
            session.contentType,
          );
        }
        const head = await storage.headStoredObject(ref);
        if (
          !head.exists ||
          head.sizeBytes !== Number(session.sizeBytes) ||
          head.contentType !== session.contentType
        ) {
          throw new BadRequestException(
            'Uploaded video size or content type does not match the selected file',
          );
        }
        await this.prisma.episodeUpload.update({
          where: { id },
          data: { status: 'uploaded' },
        });
      } else if (
        session.status !== 'uploaded' &&
        session.status !== 'completed'
      ) {
        throw new ConflictException('Upload is not ready to complete');
      }
      const result = await this.uploads.confirmUpload(
        userId,
        {
          kind: kindFromStorageKey(session.storageKey),
          storageKey: session.storageKey,
          contentType: session.contentType,
        },
        workspaceId,
      );
      await this.prisma.episodeUpload.update({
        where: { id },
        data: { status: 'completed' },
      });
      return result;
    });
  }

  async cancel(userId: string, id: string, workspaceId?: string) {
    const session = await this.prisma.episodeUpload.findUnique({
      where: { id },
    });
    if (!session) return;
    this.assertOwner(session, userId, workspaceId?.trim() || null);
    await this.withLease(id, async (current) => {
      // Once confirmed, the ordinary asset lifecycle owns it, even if the
      // complete response was lost. Cancel must never delete a saved video.
      if (current.status === 'completed' || (await this.hasAsset(current)))
        return;
      await this.prisma.episodeUpload.update({
        where: { id },
        data: { status: 'aborted' },
      });
      await this.discard(current);
    });
  }

  private async owned(userId: string, id: string, workspaceId?: string) {
    const session = await this.prisma.episodeUpload.findUnique({
      where: { id },
    });
    if (!session) throw new NotFoundException('Upload session not found');
    this.assertOwner(session, userId, workspaceId?.trim() || null);
    this.assertActive(session);
    if (session.leaseUntil && session.leaseUntil.getTime() > Date.now()) {
      throw new ConflictException(
        'Upload is being finalized. Please retry shortly.',
      );
    }
    return session;
  }

  private assertOwner(
    session: EpisodeUpload,
    userId: string,
    workspaceId: string | null,
  ) {
    if (session.userId !== userId || session.workspaceId !== workspaceId)
      throw new NotFoundException('Upload session not found');
  }

  private assertActive(session: EpisodeUpload) {
    if (
      session.status === 'aborted' ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      throw new GoneException(
        'Upload session expired. Select the video again.',
      );
    }
  }

  private storage(session: EpisodeUpload) {
    const storage = this.registry.forProvider(session.provider);
    if (!storage)
      throw new ServiceUnavailableException(
        'Episode upload storage is unavailable',
      );
    return storage;
  }

  private ref(session: EpisodeUpload): MultipartUploadRef {
    if (!session.uploadId || !session.bucket)
      throw new ConflictException('Upload has not been initialized');
    return {
      storageKey: session.storageKey,
      uploadId: session.uploadId,
      bucket: session.bucket,
      region: session.region,
    };
  }

  private async withLease<T>(
    id: string,
    action: (session: EpisodeUpload) => Promise<T>,
  ): Promise<T> {
    let until = new Date(Date.now() + OPERATION_LEASE_MS);
    const acquired = await this.prisma.episodeUpload.updateMany({
      where: {
        id,
        OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }],
      },
      data: { leaseUntil: until },
    });
    if (!acquired.count)
      throw new ConflictException('Upload is busy. Please retry shortly.');
    // A duration probe can queue behind other videos. Keep the lease alive
    // while this process is working; a crashed process naturally loses it.
    let renewal: Promise<void> | undefined;
    const heartbeat = setInterval(() => {
      if (renewal) return;
      const next = new Date(Date.now() + OPERATION_LEASE_MS);
      renewal = this.prisma.episodeUpload
        .updateMany({
          where: { id, leaseUntil: until },
          data: { leaseUntil: next },
        })
        .then((result) => {
          if (result.count) until = next;
        })
        .catch((error) => {
          this.logger.error(
            `Could not renew episode upload lease ${id}: ${String(error)}`,
          );
        })
        .finally(() => {
          renewal = undefined;
        });
    }, 30_000);
    heartbeat.unref();
    try {
      return await action(
        await this.prisma.episodeUpload.findUniqueOrThrow({ where: { id } }),
      );
    } finally {
      clearInterval(heartbeat);
      await renewal;
      try {
        await this.prisma.episodeUpload.updateMany({
          where: { id, leaseUntil: until },
          data: { leaseUntil: null },
        });
      } catch (error) {
        // The lease expires naturally. Cleanup must not replace the action's
        // error or turn a persisted successful upload into a failed response.
        this.logger.error(
          `Could not release episode upload lease ${id}: ${String(error)}`,
        );
      }
    }
  }

  private hasAsset(session: EpisodeUpload) {
    return this.prisma.mediaAsset.findFirst({
      where: {
        objectKey: session.storageKey,
        storageProvider: session.provider,
        bucket: session.bucket,
      },
      select: { id: true },
    });
  }

  private async discard(session: EpisodeUpload) {
    if (!session.uploadId || !session.bucket) return;
    const storage = this.storage(session);
    const ref = this.ref(session);
    await storage.abortMultipartUpload(ref);
    await storage.deleteObject(ref);
  }

  async sweepExpired() {
    if (!backgroundTasksEnabled()) return;
    if (this.stopping) return;
    if (this.sweeping) return this.sweeping;
    this.sweeping = this.cleanupExpired().finally(() => {
      this.sweeping = null;
    });
    return this.sweeping;
  }

  private async cleanupExpired() {
    try {
      const expired = await this.prisma.episodeUpload.findMany({
        where: {
          expiresAt: { lte: new Date() },
          ...(this.cleanupCursor ? { id: { gt: this.cleanupCursor } } : {}),
        },
        orderBy: { id: 'asc' },
        take: 20,
      });
      for (const session of expired) {
        if (this.stopping) return;
        try {
          await this.withLease(session.id, async (current) => {
            if (this.stopping) return;
            if (
              current.status !== 'completed' &&
              !(await this.hasAsset(current))
            )
              await this.discard(current);
            await this.prisma.episodeUpload.delete({
              where: { id: current.id },
            });
          });
        } catch (error) {
          if (!(error instanceof ConflictException))
            this.logger.warn(
              `Could not clean up episode upload ${session.id}: ${String(error)}`,
            );
        }
        // Failed or busy sessions must not starve later expired uploads.
        // Retry them after reaching the end, including newly expired sessions.
        this.cleanupCursor = session.id;
      }
      if (expired.length < 20) this.cleanupCursor = undefined;
    } catch (error) {
      this.logger.error(`Episode upload cleanup failed: ${String(error)}`);
    }
  }
}

export function validateEpisodeParts(
  parts: StoredUploadPart[],
  sizeBytes: number,
  partSize: number,
) {
  const count = Math.ceil(sizeBytes / partSize);
  parts.sort((a, b) => a.number - b.number);
  if (
    parts.length !== count ||
    parts.some(
      (part, index) =>
        part.number !== index + 1 ||
        !part.etag ||
        part.sizeBytes !== Math.min(partSize, sizeBytes - index * partSize),
    )
  ) {
    throw new BadRequestException(
      'Video upload is incomplete. Retry to upload the missing parts.',
    );
  }
}
