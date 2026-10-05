import {
  Body,
  Controller,
  Get,
  Header,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CrewAssetPermission, Prisma } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../../auth';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { PrismaService } from '../../infra/db/db.module';
import { StorageProviderRegistry } from '../../infra/storage/storage-provider-registry.service';
import { CrewAuthorizationService } from '../crew-authorization.service';
import { CrewAssetAccessService } from '../assets/asset-access.service';
import {
  recordTaskContractFile,
  requireAvailableTaskContractAsset,
} from '../assets/task-contract-retention';

const Page = z
  .object({
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    lifecycle: z.enum(['all', 'active', 'archived']).default('all'),
  })
  .strict();
const Attach = z.object({ assetNodeId: z.string().uuid() }).strict();
const uuid = new ZodValidationPipe(z.string().uuid());
const fileInclude = {
  assetNode: { include: { mediaAsset: true } },
} satisfies Prisma.CrewTaskContractFileInclude;
type FileRow = Prisma.CrewTaskContractFileGetPayload<{
  include: typeof fileInclude;
}>;

type ContractFileDto = {
  id: string;
  name: string;
  attachedAt: Date | null;
  sizeBytes: string | null;
  contentType: string | null;
  available: boolean;
};
type ContractTaskDto = {
  id: string;
  title: string;
  number: number;
  crew: { id: string; name: string };
  archived: boolean;
  files: ContractFileDto[];
};

@Injectable()
export class CrewTaskContractsService {
  constructor(
    private readonly db: PrismaService,
    private readonly auth: CrewAuthorizationService,
    private readonly access: CrewAssetAccessService,
    private readonly storage: StorageProviderRegistry,
  ) {}

  private async files(
    crewId: string,
    userId: string,
    rows: FileRow[],
  ): Promise<ContractFileDto[]> {
    const permissions = await this.access.resolveNodesPermissions(
      crewId,
      rows.map((r) => r.assetNodeId),
      userId,
    );
    return rows
      .filter(
        (row) =>
          permissions.get(row.assetNodeId) && row.assetNode.status === 'active',
      )
      .map((row) => ({
        id: row.id,
        name: row.assetNode.name,
        attachedAt: row.attachedAt,
        sizeBytes: row.assetNode.mediaAsset?.sizeBytes?.toString() ?? null,
        contentType: row.assetNode.mediaAsset?.contentType ?? null,
        available: Boolean(
          row.assetNode.mediaAsset &&
          row.assetNode.mediaAsset.status === 'ready' &&
          !row.assetNode.mediaAsset.deletedAt &&
          row.assetNode.mediaAsset.moderationStatus !== 'blocked',
        ),
      }));
  }
  async list(
    userId: string,
    page: z.infer<typeof Page>,
  ): Promise<{ items: ContractTaskDto[]; nextCursor: string | null }> {
    const memberships = await this.db.crewMember.findMany({
      where: { userId, status: 'active', crew: { deletedAt: null } },
      select: { crewId: true },
    });
    const crewIds: string[] = [];
    for (const member of memberships) {
      try {
        if (
          (
            await this.auth.resolve(member.crewId, userId)
          )?.permissions.includes('tasks.view')
        )
          crewIds.push(member.crewId);
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
      }
    }
    const where: Prisma.CrewTaskWhereInput = {
      crewId: { in: crewIds },
      contractFiles: { some: {} },
      ...(page.lifecycle === 'active'
        ? { deletedAt: null }
        : page.lifecycle === 'archived'
          ? { deletedAt: { not: null } }
          : {}),
    };
    if (
      page.cursor &&
      !(await this.db.crewTask.findFirst({
        where: { AND: [where, { id: page.cursor }] },
        select: { id: true },
      }))
    )
      throw new NotFoundException('Contract cursor not found in this view.');
    const rows = await this.db.crewTask.findMany({
      where: { ...where, ...(page.cursor ? { id: { lt: page.cursor } } : {}) },
      orderBy: { id: 'desc' },
      take: page.limit + 1,
      include: {
        crew: { select: { name: true } },
        contractFiles: {
          include: fileInclude,
          orderBy: [{ attachedAt: 'asc' }, { id: 'asc' }],
        },
      },
    });
    const items: ContractTaskDto[] = [];
    for (const row of rows.slice(0, page.limit)) {
      const files = await this.files(row.crewId, userId, row.contractFiles);
      if (files.length)
        items.push({
          id: row.id,
          title: row.title,
          number: row.number,
          crew: { id: row.crewId, name: row.crew.name },
          archived: Boolean(row.deletedAt),
          files,
        });
    }
    return {
      items,
      nextCursor: rows.length > page.limit ? rows[page.limit - 1].id : null,
    };
  }
  async forTask(taskId: string, userId: string) {
    const task = await this.db.crewTask.findUnique({
      where: { id: taskId },
      include: {
        contractFiles: {
          include: fileInclude,
          orderBy: [{ attachedAt: 'asc' }, { id: 'asc' }],
        },
      },
    });
    if (!task) throw new NotFoundException('Task not found.');
    await this.auth.require(task.crewId, userId, 'tasks.view');
    return { items: await this.files(task.crewId, userId, task.contractFiles) };
  }
  async attach(taskId: string, userId: string, assetNodeId: string) {
    return this.db.$transaction(async (tx) => {
      const initial = await tx.crewTask.findUnique({
        where: { id: taskId },
        select: { crewId: true },
      });
      if (!initial) throw new NotFoundException('Task not found.');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:task-writes:${initial.crewId}`},0))`;
      await this.auth.require(initial.crewId, userId, 'tasks.manage', tx);
      if (
        !(await tx.crewTask.findFirst({
          where: { id: taskId, deletedAt: null },
          select: { id: true },
        }))
      )
        throw new NotFoundException('Active task not found.');
      await requireAvailableTaskContractAsset(tx, initial.crewId, assetNodeId);
      await this.access.requireNodePermission(
        initial.crewId,
        assetNodeId,
        userId,
        CrewAssetPermission.view,
        tx,
      );
      await recordTaskContractFile(tx, taskId, assetNodeId, userId);
      return {
        id: (
          await tx.crewTaskContractFile.findUniqueOrThrow({
            where: { taskId_assetNodeId: { taskId, assetNodeId } },
            select: { id: true },
          })
        ).id,
      };
    });
  }
  async download(id: string, userId: string) {
    const row = await this.db.crewTaskContractFile.findUnique({
      where: { id },
      include: { ...fileInclude, task: { select: { crewId: true } } },
    });
    if (!row) throw new NotFoundException('Contract file not found.');
    await this.auth.require(row.task.crewId, userId, 'tasks.view');
    await this.access.requireNodePermission(
      row.task.crewId,
      row.assetNodeId,
      userId,
      CrewAssetPermission.view,
    );
    const asset = row.assetNode.mediaAsset;
    if (
      row.assetNode.status !== 'active' ||
      !asset ||
      asset.deletedAt ||
      asset.status !== 'ready' ||
      asset.moderationStatus === 'blocked' ||
      !asset.bucket ||
      !asset.objectKey
    )
      throw new NotFoundException('Contract file is unavailable.');
    const provider = this.storage.forProvider(asset.storageProvider);
    if (!provider)
      throw new NotFoundException('Contract storage is unavailable.');
    const result = await provider.createReadUrl({
      bucket: asset.bucket,
      region: asset.region,
      storageKey: asset.objectKey,
      contentType: asset.contentType,
      filename: row.assetNode.name,
      cacheControl: 'private, no-store',
      expiresInSeconds: 60,
    });
    await this.access.requireNodePermission(
      row.task.crewId,
      row.assetNodeId,
      userId,
      CrewAssetPermission.view,
    );
    return result;
  }
}
@Controller()
export class CrewTaskContractsController {
  constructor(private readonly service: CrewTaskContractsService) {}
  @Get('me/task-contracts')
  @Header('Cache-Control', 'private, no-store')
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(Page)) page: z.infer<typeof Page>,
  ) {
    return this.service.list(user.userId, page);
  }
  @Get('crew-tasks/:taskId/contracts')
  @Header('Cache-Control', 'private, no-store')
  forTask(
    @Param('taskId', uuid) taskId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.forTask(taskId, user.userId);
  }
  @Post('crew-tasks/:taskId/contracts')
  attach(
    @Param('taskId', uuid) taskId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(Attach)) input: z.infer<typeof Attach>,
  ) {
    return this.service.attach(taskId, user.userId, input.assetNodeId);
  }
  @Get('task-contract-files/:id/download')
  @Header('Cache-Control', 'private, no-store')
  download(@Param('id', uuid) id: string, @CurrentUser() user: AuthUser) {
    return this.service.download(id, user.userId);
  }
}
