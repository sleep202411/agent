import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ProjectMemberRole,
  WorkspaceMemberAccessScope,
  WorkspaceMemberRole,
  WorkspaceMemberStatus,
  type ProjectSkillScope,
} from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { projectSkillVersionChecksum } from '@repo/agent-skills';
import Ajv from 'ajv';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { StoryPermissionService } from '../story-studio/story-permission.service';
import { WorkspacePermissionService } from '../workspaces';
import type {
  DeleteProjectSkillBody,
  ImportProjectSkillBody,
  InstallProjectSkillBody,
  ProjectSkillOwnerKind,
  SetProjectSkillDefaultsBody,
  UpdateProjectSkillBody,
} from './project-skills.dto';
import {
  parseProjectSkillPackage,
  type UploadedProjectSkillFile,
} from './project-skill-package';
import { ProjectSkillsResolver } from './project-skills.resolver';

interface OwnerContext {
  ownerKind: ProjectSkillOwnerKind;
  projectId: string;
  workspaceId: string;
  canManage: boolean;
}

type ProjectSkillInstallationWithRelations =
  Prisma.ProjectSkillInstallationGetPayload<{
    include: { skill: true; pinnedVersion: true; activations: true };
  }>;

@Injectable()
export class ProjectSkillsService {
  private readonly ajv = new Ajv({ allErrors: true, strict: true });

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspacePermissions: WorkspacePermissionService,
    private readonly storyPermissions: StoryPermissionService,
    private readonly resolver: ProjectSkillsResolver,
  ) {}

  async getEffective(
    user: AuthUser,
    ownerKind: ProjectSkillOwnerKind,
    projectId: string,
    scope: ProjectSkillScope,
    workbenchMode?: string,
    sourceSurface?: string,
  ) {
    await this.requireRead(user.userId, ownerKind, projectId);
    return this.resolver.resolve({
      ownerKind,
      projectId,
      scope,
      workbenchMode,
      sourceSurface,
    });
  }

  async listCatalog(
    user: AuthUser,
    ownerKind: ProjectSkillOwnerKind,
    projectId: string,
    filters: { kind?: string; capability?: string; query?: string },
  ) {
    const context = await this.requireRead(user.userId, ownerKind, projectId);
    const rows = await this.prisma.skillCatalogItem.findMany({
      where: {
        status: 'published',
        ...(filters.kind && ['general', 'image', 'video'].includes(filters.kind)
          ? { kind: filters.kind as 'general' | 'image' | 'video' }
          : {}),
        AND: [
          catalogAccessWhere(context),
          ...(filters.query?.trim()
            ? [
                {
                  OR: [
                    {
                      name: {
                        contains: filters.query.trim(),
                        mode: 'insensitive' as const,
                      },
                    },
                    {
                      description: {
                        contains: filters.query.trim(),
                        mode: 'insensitive' as const,
                      },
                    },
                  ],
                },
              ]
            : []),
        ],
      },
      include: {
        latestPublishedVersion: true,
        installations: {
          where: installationOwnerWhere(ownerKind, projectId),
          include: { activations: true, pinnedVersion: true },
          take: 1,
        },
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });

    const items = rows
      .filter((row) => {
        if (!filters.capability) return true;
        return stringArray(row.latestPublishedVersion?.capabilities).includes(
          filters.capability,
        );
      })
      .map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description,
        localizedMetadata: row.localizedMetadata,
        publisherName: row.publisherName,
        category: row.category,
        kind: row.kind,
        visibility: row.visibility,
        ownershipScope: catalogOwnershipScope(row.visibility),
        previewUrl: row.previewUrl,
        previewVideoUrl: row.previewVideoUrl,
        latestVersion: row.latestPublishedVersion
          ? publicVersion(row.latestPublishedVersion)
          : null,
        installation: row.installations[0]
          ? publicInstallation(row.installations[0])
          : null,
      }));
    const state = await this.readState(context);
    const canManageWorkspace = await this.canManageWorkspace(
      user.userId,
      context.workspaceId,
    );
    return {
      ownerKind,
      projectId,
      projectRevision: state?.revision ?? 0,
      canManage: context.canManage,
      canManageWorkspace,
      items,
    };
  }

  async importAndInstall(
    user: AuthUser,
    ownerKind: ProjectSkillOwnerKind,
    projectId: string,
    body: ImportProjectSkillBody,
    file: UploadedProjectSkillFile,
    requestId?: string,
  ) {
    const context = await this.requireManage(user.userId, ownerKind, projectId);
    if (body.scope === 'workspace') {
      await this.workspacePermissions.requireWorkspaceRole(
        user.userId,
        context.workspaceId,
        WorkspaceMemberRole.admin,
      );
    }
    const parsed = parseProjectSkillPackage(file);
    const fileChecksum = createHash('sha256').update(file.buffer).digest('hex');
    const skillId = randomUUID();
    const versionId = randomUUID();
    const installationId = randomUUID();
    const capabilities = capabilitiesForKind(body.kind);
    const generationPolicy = {
      ...(capabilities.includes('image_generation')
        ? { image: { promptSuffix: parsed.instructions } }
        : {}),
      ...(capabilities.includes('video_generation')
        ? { video: { promptSuffix: parsed.instructions } }
        : {}),
      promptAuthoring: { instructions: parsed.instructions },
    };
    const manifest = {
      id: versionId,
      skillId,
      version: '1.0.0',
      manifestSchemaVersion: 'fizzdragon.skill/v1',
      instructions: parsed.instructions,
      generationPolicy,
      configSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
      capabilities,
      projectKinds: ['platform', 'story'],
      workbenchModes: [],
      toolIds: [],
      riskPolicy: { allowsWrite: false, allowsPaidGeneration: false },
      evalSuite: null,
    };
    const versionChecksum = projectSkillVersionChecksum(manifest);
    await this.ensureState(context);

    return this.executeIdempotent(
      context,
      user.userId,
      body.idempotencyKey,
      'catalog_import',
      {
        scope: body.scope,
        kind: body.kind,
        expectedProjectRevision: body.expectedProjectRevision,
        fileChecksum,
      },
      async (tx) => {
        const projectRevision = await this.bumpProjectRevision(
          tx,
          context,
          body.expectedProjectRevision,
        );
        const skill = await tx.skillCatalogItem.create({
          data: {
            id: skillId,
            workspaceId: context.workspaceId,
            ...(body.scope === 'project' ? ownerData(context) : {}),
            createdByUserId: user.userId,
            slug: `${parsed.slugBase}-${skillId.slice(0, 8)}`,
            name: parsed.displayName,
            description: parsed.description,
            localizedMetadata: {
              origin: 'user_upload',
              scope: body.scope,
              sourceFiles: parsed.sourceFiles,
              originalFilename: file.originalname,
              packageName: parsed.packageName,
            },
            publisherName: (
              user.nickName ??
              user.userName ??
              'Project creator'
            ).slice(0, 160),
            category: 'custom',
            kind: body.kind,
            visibility: body.scope === 'project' ? 'private' : 'unlisted',
            status: 'published',
          },
        });
        const version = await tx.skillVersion.create({
          data: {
            id: versionId,
            skillId,
            version: manifest.version,
            status: 'published',
            manifestSchemaVersion: manifest.manifestSchemaVersion,
            instructions: manifest.instructions,
            generationPolicy: manifest.generationPolicy,
            configSchema: manifest.configSchema,
            capabilities: manifest.capabilities,
            projectKinds: manifest.projectKinds,
            workbenchModes: manifest.workbenchModes,
            toolIds: manifest.toolIds,
            riskPolicy: manifest.riskPolicy,
            evalSuite: manifest.evalSuite,
            checksum: versionChecksum,
            publishedAt: new Date(),
          },
        });
        await tx.skillCatalogItem.update({
          where: { id: skillId },
          data: { latestPublishedVersionId: versionId },
        });
        const installation = await tx.projectSkillInstallation.create({
          data: {
            id: installationId,
            workspaceId: context.workspaceId,
            ...ownerData(context),
            skillId,
            pinnedVersionId: versionId,
            status: 'active',
            installedByUserId: user.userId,
            updatedByUserId: user.userId,
          },
          include: { skill: true, pinnedVersion: true, activations: true },
        });
        const response = {
          projectRevision,
          skill: {
            id: skill.id,
            slug: skill.slug,
            name: skill.name,
            description: skill.description,
            localizedMetadata: skill.localizedMetadata,
            publisherName: skill.publisherName,
            category: skill.category,
            kind: skill.kind,
            visibility: skill.visibility,
            ownershipScope: catalogOwnershipScope(skill.visibility),
            previewUrl: skill.previewUrl,
            previewVideoUrl: skill.previewVideoUrl,
            latestVersion: publicVersion(version),
            installation: publicInstallation(installation),
          },
          installation: publicInstallation(installation),
        };
        await tx.projectSkillAudit.create({
          data: {
            workspaceId: context.workspaceId,
            ...ownerData(context),
            installationId,
            skillId,
            versionId,
            action: 'install',
            actorUserId: user.userId,
            requestId: requestId ?? null,
            after: response.installation as Prisma.InputJsonValue,
          },
        });
        return response;
      },
    );
  }

  async listInstallations(
    user: AuthUser,
    ownerKind: ProjectSkillOwnerKind,
    projectId: string,
  ) {
    const context = await this.requireRead(user.userId, ownerKind, projectId);
    const [state, rows] = await Promise.all([
      this.readState(context),
      this.prisma.projectSkillInstallation.findMany({
        where: installationOwnerWhere(ownerKind, projectId),
        include: { skill: true, pinnedVersion: true, activations: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    ]);
    return {
      ownerKind,
      projectId,
      projectRevision: state?.revision ?? 0,
      canManage: context.canManage,
      installations: rows.map(publicInstallation),
    };
  }

  async install(
    user: AuthUser,
    ownerKind: ProjectSkillOwnerKind,
    projectId: string,
    body: InstallProjectSkillBody,
    requestId?: string,
  ) {
    const context = await this.requireManage(user.userId, ownerKind, projectId);
    await this.ensureState(context);

    return this.executeIdempotent(
      context,
      user.userId,
      body.idempotencyKey,
      'install',
      body,
      async (tx) => {
        const skill = await tx.skillCatalogItem.findFirst({
          where: {
            id: body.skillId,
            status: 'published',
            AND: [catalogAccessWhere(context)],
          },
          include: { latestPublishedVersion: true },
        });
        if (!skill?.latestPublishedVersion) {
          throw new NotFoundException({
            code: 'PROJECT_SKILL_NOT_FOUND',
            msg: 'Skill not found in the published catalog.',
          });
        }
        const version = body.versionId
          ? await tx.skillVersion.findFirst({
              where: {
                id: body.versionId,
                skillId: body.skillId,
                status: { in: ['published', 'deprecated'] },
              },
            })
          : skill.latestPublishedVersion;
        if (!version) {
          throw new NotFoundException({
            code: 'PROJECT_SKILL_VERSION_NOT_FOUND',
            msg: 'The requested published Skill version was not found.',
          });
        }
        this.assertCompatible(version.projectKinds, ownerKind);
        const config = body.config ?? {};
        this.assertConfig(version.configSchema, config);
        const capabilities = stringArray(version.capabilities);
        const defaultScopes = [...new Set(body.defaultScopes ?? [])];
        for (const scope of defaultScopes) {
          if (!capabilities.includes(scope)) {
            throw new BadRequestException({
              code: 'PROJECT_SKILL_SCOPE_INCOMPATIBLE',
              msg: `${skill.name} does not support ${scope}.`,
            });
          }
        }
        const projectRevision = await this.bumpProjectRevision(
          tx,
          context,
          body.expectedProjectRevision,
        );
        let installation: ProjectSkillInstallationWithRelations;
        try {
          installation = await tx.projectSkillInstallation.create({
            data: {
              workspaceId: context.workspaceId,
              ...ownerData(context),
              skillId: skill.id,
              pinnedVersionId: version.id,
              config: config as Prisma.InputJsonValue,
              status: 'active',
              installedByUserId: user.userId,
              updatedByUserId: user.userId,
              activations: {
                create: defaultScopes.map((scope) => ({ scope })),
              },
            },
            include: { skill: true, pinnedVersion: true, activations: true },
          });
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new ConflictException({
              code: 'PROJECT_SKILL_ALREADY_INSTALLED',
              msg: 'This Skill is already installed in the project.',
            });
          }
          throw error;
        }
        const response = {
          projectRevision,
          installation: publicInstallation(installation),
        };
        await tx.projectSkillAudit.create({
          data: {
            workspaceId: context.workspaceId,
            ...ownerData(context),
            installationId: installation.id,
            skillId: skill.id,
            versionId: version.id,
            action: 'install',
            actorUserId: user.userId,
            requestId: requestId ?? null,
            after: response.installation as Prisma.InputJsonValue,
          },
        });
        return response;
      },
    );
  }

  async update(
    user: AuthUser,
    ownerKind: ProjectSkillOwnerKind,
    projectId: string,
    installationId: string,
    body: UpdateProjectSkillBody,
    requestId?: string,
  ) {
    const context = await this.requireManage(user.userId, ownerKind, projectId);
    await this.ensureState(context);
    return this.executeIdempotent(
      context,
      user.userId,
      body.idempotencyKey,
      'update',
      { installationId, ...body },
      async (tx) => {
        const observed = await this.requireInstallation(
          context,
          installationId,
          tx,
        );
        const version = body.versionId
          ? await tx.skillVersion.findFirst({
              where: {
                id: body.versionId,
                skillId: observed.skillId,
                status: { in: ['published', 'deprecated'] },
              },
            })
          : observed.pinnedVersion;
        if (!version) {
          throw new NotFoundException({
            code: 'PROJECT_SKILL_VERSION_NOT_FOUND',
            msg: 'The requested Skill version was not found.',
          });
        }
        this.assertCompatible(version.projectKinds, ownerKind);
        const config = body.config ?? recordValue(observed.config);
        this.assertConfig(version.configSchema, config);
        const projectRevision = await this.bumpProjectRevision(
          tx,
          context,
          body.expectedProjectRevision,
        );
        const updated = await tx.projectSkillInstallation.updateMany({
          where: {
            id: installationId,
            ...installationOwnerWhere(ownerKind, projectId),
            revision: body.expectedRevision,
          },
          data: {
            ...(body.versionId ? { pinnedVersionId: version.id } : {}),
            ...(body.config
              ? { config: body.config as Prisma.InputJsonValue }
              : {}),
            ...(body.status ? { status: body.status } : {}),
            updatedByUserId: user.userId,
            revision: { increment: 1 },
          },
        });
        if (updated.count !== 1) installationConflict();
        const row = await tx.projectSkillInstallation.findUniqueOrThrow({
          where: { id: installationId },
          include: { skill: true, pinnedVersion: true, activations: true },
        });
        const response = {
          projectRevision,
          installation: publicInstallation(row),
        };
        await tx.projectSkillAudit.create({
          data: {
            workspaceId: context.workspaceId,
            ...ownerData(context),
            installationId,
            skillId: row.skillId,
            versionId: row.pinnedVersionId,
            action: 'update',
            actorUserId: user.userId,
            requestId: requestId ?? null,
            before: publicInstallation(observed) as Prisma.InputJsonValue,
            after: response.installation as Prisma.InputJsonValue,
          },
        });
        return response;
      },
    );
  }

  async uninstall(
    user: AuthUser,
    ownerKind: ProjectSkillOwnerKind,
    projectId: string,
    installationId: string,
    body: DeleteProjectSkillBody,
    requestId?: string,
  ) {
    const context = await this.requireManage(user.userId, ownerKind, projectId);
    await this.ensureState(context);
    return this.executeIdempotent(
      context,
      user.userId,
      body.idempotencyKey,
      'uninstall',
      { installationId, ...body },
      async (tx) => {
        const observed = await this.requireInstallation(
          context,
          installationId,
          tx,
        );
        const projectRevision = await this.bumpProjectRevision(
          tx,
          context,
          body.expectedProjectRevision,
        );
        await tx.projectSkillAudit.create({
          data: {
            workspaceId: context.workspaceId,
            ...ownerData(context),
            installationId,
            skillId: observed.skillId,
            versionId: observed.pinnedVersionId,
            action: 'uninstall',
            actorUserId: user.userId,
            requestId: requestId ?? null,
            before: publicInstallation(observed) as Prisma.InputJsonValue,
          },
        });
        const deleted = await tx.projectSkillInstallation.deleteMany({
          where: {
            id: installationId,
            ...installationOwnerWhere(ownerKind, projectId),
            revision: body.expectedRevision,
          },
        });
        if (deleted.count !== 1) installationConflict();
        return { projectRevision, installationId, uninstalled: true };
      },
    );
  }

  async setDefaults(
    user: AuthUser,
    ownerKind: ProjectSkillOwnerKind,
    projectId: string,
    scope: ProjectSkillScope,
    body: SetProjectSkillDefaultsBody,
    requestId?: string,
  ) {
    const context = await this.requireManage(user.userId, ownerKind, projectId);
    await this.ensureState(context);
    const workbenchMode = body.workbenchMode ?? '';
    const sourceSurface = body.sourceSurface ?? '';
    return this.executeIdempotent(
      context,
      user.userId,
      body.idempotencyKey,
      'defaults_update',
      { scope, ...body },
      async (tx) => {
        const requestedIds = [...new Set(body.installationIds)];
        const installations = await tx.projectSkillInstallation.findMany({
          where: {
            ...installationOwnerWhere(ownerKind, projectId),
            status: 'active',
          },
          include: { skill: true, pinnedVersion: true, activations: true },
        });
        const byId = new Map(installations.map((row) => [row.id, row]));
        if (requestedIds.some((id) => !byId.has(id))) {
          throw new BadRequestException({
            code: 'PROJECT_SKILL_NOT_INSTALLED',
            msg: 'Every default Skill must be actively installed in this project.',
          });
        }
        for (const id of requestedIds) {
          const row = byId.get(id)!;
          if (!stringArray(row.pinnedVersion.capabilities).includes(scope)) {
            throw new BadRequestException({
              code: 'PROJECT_SKILL_SCOPE_INCOMPATIBLE',
              msg: `${row.skill.name} does not support ${scope}.`,
            });
          }
        }
        const projectRevision = await this.bumpProjectRevision(
          tx,
          context,
          body.expectedProjectRevision,
        );
        const installationIds = installations.map((row) => row.id);
        const previous = installations.filter((row) =>
          row.activations.some(
            (activation) =>
              activation.scope === scope &&
              activation.workbenchMode === workbenchMode &&
              activation.sourceSurface === sourceSurface &&
              activation.defaultEnabled,
          ),
        );
        await tx.projectSkillActivation.deleteMany({
          where: {
            installationId: { in: installationIds },
            scope,
            workbenchMode,
            sourceSurface,
          },
        });
        if (requestedIds.length > 0) {
          await tx.projectSkillActivation.createMany({
            data: requestedIds.map((installationId) => ({
              installationId,
              scope,
              workbenchMode,
              sourceSurface,
              defaultEnabled: true,
            })),
          });
        }
        const affected = new Set([
          ...previous.map((row) => row.id),
          ...requestedIds,
        ]);
        await tx.projectSkillAudit.createMany({
          data: [...affected].map((id) => {
            const row = byId.get(id)!;
            return {
              workspaceId: context.workspaceId,
              ...ownerData(context),
              installationId: id,
              skillId: row.skillId,
              versionId: row.pinnedVersionId,
              action: 'defaults_update' as const,
              actorUserId: user.userId,
              requestId: requestId ?? null,
              before: {
                scope,
                workbenchMode: workbenchMode || null,
                sourceSurface: sourceSurface || null,
                defaultEnabled: previous.some((item) => item.id === id),
              },
              after: {
                scope,
                workbenchMode: workbenchMode || null,
                sourceSurface: sourceSurface || null,
                defaultEnabled: requestedIds.includes(id),
              },
            };
          }),
        });
        return {
          projectRevision,
          scope,
          workbenchMode: workbenchMode || null,
          sourceSurface: sourceSurface || null,
          installationIds: requestedIds,
        };
      },
    );
  }

  private async requireRead(
    actorId: string,
    ownerKind: ProjectSkillOwnerKind,
    projectId: string,
  ): Promise<OwnerContext> {
    if (ownerKind === 'platform') {
      const project = await this.workspacePermissions.requireProjectRole(
        actorId,
        projectId,
        ProjectMemberRole.viewer,
      );
      const role = await this.workspacePermissions.resolveEffectiveProjectRole(
        actorId,
        project,
      );
      return {
        ownerKind,
        projectId,
        workspaceId: project.workspaceId,
        canManage:
          role === ProjectMemberRole.owner || role === ProjectMemberRole.admin,
      };
    }
    const result = await this.storyPermissions.requireProject(
      actorId,
      projectId,
      'story.read',
    );
    return {
      ownerKind,
      projectId,
      workspaceId: result.project.workspaceId,
      canManage: result.capabilities.includes('story.admin'),
    };
  }

  private async canManageWorkspace(
    actorId: string,
    workspaceId: string,
  ): Promise<boolean> {
    const membership = await this.prisma.workspaceMember.findFirst({
      where: {
        workspaceId,
        userId: actorId,
        status: WorkspaceMemberStatus.active,
        removedAt: null,
        accessScope: WorkspaceMemberAccessScope.workspace,
        role: { in: [WorkspaceMemberRole.owner, WorkspaceMemberRole.admin] },
      },
      select: { id: true },
    });
    return membership !== null;
  }

  private async requireManage(
    actorId: string,
    ownerKind: ProjectSkillOwnerKind,
    projectId: string,
  ): Promise<OwnerContext> {
    if (ownerKind === 'platform') {
      const project = await this.workspacePermissions.requireProjectRole(
        actorId,
        projectId,
        ProjectMemberRole.admin,
      );
      return {
        ownerKind,
        projectId,
        workspaceId: project.workspaceId,
        canManage: true,
      };
    }
    const result = await this.storyPermissions.requireProject(
      actorId,
      projectId,
      'story.admin',
    );
    if (!result.capabilities.includes('story.admin')) {
      throw new ForbiddenException({
        code: 'PROJECT_SKILL_MANAGE_DENIED',
        msg: 'Only project owners and administrators can manage Skills.',
      });
    }
    return {
      ownerKind,
      projectId,
      workspaceId: result.project.workspaceId,
      canManage: true,
    };
  }

  private async ensureState(context: OwnerContext): Promise<void> {
    if (context.ownerKind === 'platform') {
      await this.prisma.projectSkillState.upsert({
        where: { platformProjectId: context.projectId },
        create: {
          workspaceId: context.workspaceId,
          platformProjectId: context.projectId,
        },
        update: {},
      });
      return;
    }
    await this.prisma.projectSkillState.upsert({
      where: { storyProjectId: context.projectId },
      create: {
        workspaceId: context.workspaceId,
        storyProjectId: context.projectId,
      },
      update: {},
    });
  }

  private readState(context: OwnerContext) {
    return this.prisma.projectSkillState.findFirst({
      where: stateOwnerWhere(context.ownerKind, context.projectId),
      select: { id: true, revision: true },
    });
  }

  private async bumpProjectRevision(
    tx: Prisma.TransactionClient,
    context: OwnerContext,
    expectedRevision: number,
  ): Promise<number> {
    const updated = await tx.projectSkillState.updateMany({
      where: {
        ...stateOwnerWhere(context.ownerKind, context.projectId),
        revision: expectedRevision,
      },
      data: { revision: { increment: 1 } },
    });
    if (updated.count !== 1) {
      throw new ConflictException({
        code: 'PROJECT_SKILL_REVISION_CONFLICT',
        msg: 'Project Skills changed in another session. Refresh and try again.',
      });
    }
    return expectedRevision + 1;
  }

  private async requireInstallation(
    context: OwnerContext,
    installationId: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const row = await db.projectSkillInstallation.findFirst({
      where: {
        id: installationId,
        ...installationOwnerWhere(context.ownerKind, context.projectId),
      },
      include: { skill: true, pinnedVersion: true, activations: true },
    });
    if (!row) {
      throw new NotFoundException({
        code: 'PROJECT_SKILL_INSTALLATION_NOT_FOUND',
        msg: 'Project Skill installation not found.',
      });
    }
    return row;
  }

  private assertCompatible(value: unknown, ownerKind: ProjectSkillOwnerKind) {
    const projectKinds = stringArray(value);
    if (projectKinds.length > 0 && !projectKinds.includes(ownerKind)) {
      throw new BadRequestException({
        code: 'PROJECT_SKILL_PROJECT_INCOMPATIBLE',
        msg: `This Skill is not compatible with ${ownerKind} projects.`,
      });
    }
  }

  private assertConfig(schema: unknown, config: Record<string, unknown>) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
      throw new Error('Published Skill config schema is invalid.');
    }
    const validate = this.ajv.compile(schema);
    if (!validate(config)) {
      throw new BadRequestException({
        code: 'PROJECT_SKILL_CONFIG_INVALID',
        msg: this.ajv.errorsText(validate.errors, { separator: '; ' }),
      });
    }
  }

  private async executeIdempotent<T extends Record<string, unknown>>(
    context: OwnerContext,
    actorUserId: string,
    idempotencyKey: string,
    operation: string,
    request: unknown,
    mutate: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const requestHash = hashRequest({
      ownerKind: context.ownerKind,
      projectId: context.projectId,
      operation,
      request,
    });
    const replay = await this.readReplay(
      context,
      actorUserId,
      idempotencyKey,
      requestHash,
    );
    if (replay) return replay as T;

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Identical in-flight retries must wait for the original receipt before
        // checking revisions or installation state. Match the ledger's scope.
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([
            'project-skill-mutation',
            context.workspaceId,
            idempotencyKey,
          ])}, 0))
        `;
        const existing = await tx.projectSkillMutation.findUnique({
          where: {
            workspaceId_idempotencyKey: {
              workspaceId: context.workspaceId,
              idempotencyKey,
            },
          },
        });
        if (existing) {
          return this.assertReplay<T>(existing, actorUserId, requestHash);
        }
        const response = await mutate(tx);
        await tx.projectSkillMutation.create({
          data: {
            workspaceId: context.workspaceId,
            idempotencyKey,
            operation,
            requestHash,
            actorUserId,
            response: response as Prisma.InputJsonValue,
          },
        });
        return response;
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.readReplay(
        context,
        actorUserId,
        idempotencyKey,
        requestHash,
      );
      if (raced) return raced as T;
      throw error;
    }
  }

  private async readReplay(
    context: OwnerContext,
    actorUserId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<Record<string, unknown> | null> {
    const row = await this.prisma.projectSkillMutation.findUnique({
      where: {
        workspaceId_idempotencyKey: {
          workspaceId: context.workspaceId,
          idempotencyKey,
        },
      },
    });
    return row
      ? this.assertReplay<Record<string, unknown>>(
          row,
          actorUserId,
          requestHash,
        )
      : null;
  }

  private assertReplay<T>(
    row: { actorUserId: string; requestHash: string; response: unknown },
    actorUserId: string,
    requestHash: string,
  ): T {
    if (row.actorUserId !== actorUserId || row.requestHash !== requestHash) {
      throw new ConflictException({
        code: 'PROJECT_SKILL_IDEMPOTENCY_CONFLICT',
        msg: 'This idempotency key was already used for another request.',
      });
    }
    return row.response as T;
  }
}

function installationOwnerWhere(
  ownerKind: ProjectSkillOwnerKind,
  projectId: string,
) {
  return ownerKind === 'platform'
    ? { platformProjectId: projectId, storyProjectId: null }
    : { storyProjectId: projectId, platformProjectId: null };
}

function stateOwnerWhere(ownerKind: ProjectSkillOwnerKind, projectId: string) {
  return ownerKind === 'platform'
    ? { platformProjectId: projectId }
    : { storyProjectId: projectId };
}

function ownerData(context: OwnerContext) {
  return context.ownerKind === 'platform'
    ? { platformProjectId: context.projectId, storyProjectId: null }
    : { storyProjectId: context.projectId, platformProjectId: null };
}

function catalogAccessWhere(context: OwnerContext) {
  return {
    OR: [
      { visibility: 'public' as const },
      {
        visibility: 'unlisted' as const,
        workspaceId: context.workspaceId,
        platformProjectId: null,
        storyProjectId: null,
      },
      {
        visibility: 'private' as const,
        workspaceId: context.workspaceId,
        ...ownerData(context),
      },
    ],
  };
}

function catalogOwnershipScope(visibility: 'public' | 'unlisted' | 'private') {
  if (visibility === 'unlisted') return 'workspace' as const;
  if (visibility === 'private') return 'project' as const;
  return 'community' as const;
}

function capabilitiesForKind(
  kind: 'general' | 'image' | 'video',
): ProjectSkillScope[] {
  if (kind === 'image') {
    return ['prompt_authoring', 'image_generation'];
  }
  if (kind === 'video') {
    return ['agent_prompt', 'prompt_authoring', 'video_generation'];
  }
  return [
    'agent_prompt',
    'prompt_authoring',
    'image_generation',
    'video_generation',
  ];
}

function publicVersion(version: {
  id: string;
  version: string;
  checksum: string;
  capabilities: unknown;
  projectKinds: unknown;
  workbenchModes: unknown;
}) {
  return {
    id: version.id,
    version: version.version,
    checksum: version.checksum,
    capabilities: stringArray(version.capabilities),
    projectKinds: stringArray(version.projectKinds),
    workbenchModes: stringArray(version.workbenchModes),
  };
}

function publicInstallation(row: {
  id: string;
  skillId: string;
  pinnedVersionId: string;
  status: string;
  revision: number;
  config: unknown;
  createdAt: Date;
  updatedAt: Date;
  skill?: {
    slug: string;
    name: string;
    previewUrl: string | null;
    previewVideoUrl: string | null;
    localizedMetadata: unknown;
  };
  pinnedVersion: {
    id: string;
    version: string;
    checksum: string;
    capabilities: unknown;
    projectKinds: unknown;
    workbenchModes: unknown;
  };
  activations: Array<{
    scope: ProjectSkillScope;
    workbenchMode: string;
    sourceSurface: string;
    defaultEnabled: boolean;
  }>;
}) {
  return {
    id: row.id,
    skillId: row.skillId,
    slug: row.skill?.slug,
    name: row.skill?.name,
    previewUrl: row.skill?.previewUrl,
    previewVideoUrl: row.skill?.previewVideoUrl,
    translationKey: stringField(row.skill?.localizedMetadata, 'translationKey'),
    pinnedVersionId: row.pinnedVersionId,
    version: publicVersion(row.pinnedVersion),
    status: row.status,
    revision: row.revision,
    config: recordValue(row.config),
    defaults: row.activations
      .filter((activation) => activation.defaultEnabled)
      .map((activation) => ({
        scope: activation.scope,
        workbenchMode: activation.workbenchMode || null,
        sourceSurface: activation.sourceSurface || null,
      })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? [...value]
    : [];
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(value: unknown, field: string): string | undefined {
  const record = recordValue(value);
  const candidate = record[field];
  return typeof candidate === 'string' && candidate.trim()
    ? candidate.trim()
    : undefined;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(row[key])}`)
    .join(',')}}`;
}

function hashRequest(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function installationConflict(): never {
  throw new ConflictException({
    code: 'PROJECT_SKILL_INSTALLATION_REVISION_CONFLICT',
    msg: 'This Skill installation changed in another session. Refresh and try again.',
  });
}
