import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  projectSkillSnapshotChecksum,
  ProjectSkillResolutionSnapshotSchema,
  SkillGenerationPolicySchema,
  type ProjectSkillResolutionSnapshot,
  type ProjectSkillScope,
} from '@repo/agent-skills';
import { PrismaService } from '../infra/db/db.module';
import type {
  ProjectSkillOwnerKind,
  ProjectSkillSelection,
} from './project-skills.dto';

export interface ResolveProjectSkillsInput {
  ownerKind: ProjectSkillOwnerKind;
  projectId: string;
  scope: ProjectSkillScope;
  workbenchMode?: string;
  sourceSurface?: string;
  selection?: ProjectSkillSelection;
}

@Injectable()
export class ProjectSkillsResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    input: ResolveProjectSkillsInput,
  ): Promise<ProjectSkillResolutionSnapshot> {
    const includeIds = uniqueIds(input.selection?.includeInstallationIds ?? []);
    const excludeIds = uniqueIds(input.selection?.excludeInstallationIds ?? []);
    const overlap = includeIds.find((id) => excludeIds.includes(id));
    if (overlap) {
      throw new BadRequestException({
        code: 'PROJECT_SKILL_SELECTION_CONFLICT',
        msg: 'A Skill cannot be included and excluded in the same request.',
      });
    }

    const ownerWhere = installationOwnerWhere(input.ownerKind, input.projectId);
    const [state, installations] = await Promise.all([
      this.prisma.projectSkillState.findFirst({
        where: stateOwnerWhere(input.ownerKind, input.projectId),
        select: { revision: true },
      }),
      this.prisma.projectSkillInstallation.findMany({
        where: { ...ownerWhere, status: 'active' },
        include: {
          skill: true,
          pinnedVersion: true,
          activations: true,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    ]);

    const byId = new Map(installations.map((row) => [row.id, row]));
    const unknownRequested = [...includeIds, ...excludeIds].filter(
      (id) => !byId.has(id),
    );
    if (unknownRequested.length > 0) {
      throw new BadRequestException({
        code: 'PROJECT_SKILL_NOT_INSTALLED',
        msg: 'One or more selected Skills are not active in this project.',
      });
    }

    const includeSet = new Set(includeIds);
    const excludeSet = new Set(excludeIds);
    const resolved = installations.flatMap((installation) => {
      const capabilities = stringArray(
        installation.pinnedVersion.capabilities,
        'capabilities',
      );
      const projectKinds = stringArray(
        installation.pinnedVersion.projectKinds,
        'projectKinds',
      );
      const workbenchModes = stringArray(
        installation.pinnedVersion.workbenchModes,
        'workbenchModes',
      );
      const compatible =
        capabilities.includes(input.scope) &&
        (projectKinds.length === 0 || projectKinds.includes(input.ownerKind)) &&
        (workbenchModes.length === 0 ||
          Boolean(
            input.workbenchMode && workbenchModes.includes(input.workbenchMode),
          ));
      if (!compatible) {
        if (includeSet.has(installation.id)) {
          throw new BadRequestException({
            code: 'PROJECT_SKILL_INCOMPATIBLE',
            msg: `${installation.skill.name} is not compatible with this generation context.`,
          });
        }
        return [];
      }

      const isDefault = installation.activations.some(
        (activation) =>
          activation.defaultEnabled &&
          activation.scope === input.scope &&
          (!activation.workbenchMode ||
            activation.workbenchMode === input.workbenchMode) &&
          (!activation.sourceSurface ||
            activation.sourceSurface === input.sourceSurface),
      );
      // A default Skill can also be represented by an inline chip in the
      // prompt document. Preserve its project-default provenance in that case;
      // `turn_selection` is reserved for a non-default Skill the user added to
      // this one request. An explicit exclusion always wins over the default.
      const defaultEnabled = isDefault && !excludeSet.has(installation.id);
      const source = defaultEnabled
        ? ('project_default' as const)
        : includeSet.has(installation.id)
          ? ('turn_selection' as const)
          : null;
      if (!source) return [];

      return [
        {
          installationId: installation.id,
          skillId: installation.skillId,
          slug: installation.skill.slug,
          name: installation.skill.name,
          versionId: installation.pinnedVersionId,
          version: installation.pinnedVersion.version,
          versionChecksum: installation.pinnedVersion.checksum,
          instructions: installation.pinnedVersion.instructions,
          generationPolicy: SkillGenerationPolicySchema.parse(
            installation.pinnedVersion.generationPolicy,
          ),
          toolIds: stringArray(installation.pinnedVersion.toolIds, 'toolIds'),
          config: recordValue(installation.config, 'config'),
          source,
        },
      ];
    });

    const unsigned = {
      schemaVersion: 'project-skill-resolution/v1' as const,
      resolutionId: randomUUID(),
      ownerKind: input.ownerKind,
      projectId: input.projectId,
      projectRevision: state?.revision ?? 0,
      scope: input.scope,
      workbenchMode: input.workbenchMode?.trim() || null,
      sourceSurface: input.sourceSurface?.trim() || null,
      resolvedAt: new Date().toISOString(),
      skills: resolved,
    };
    return ProjectSkillResolutionSnapshotSchema.parse({
      ...unsigned,
      checksum: projectSkillSnapshotChecksum(unsigned),
    });
  }

  validateFrozen(
    value: unknown,
    expected: Pick<
      ResolveProjectSkillsInput,
      'ownerKind' | 'projectId' | 'scope'
    >,
  ): ProjectSkillResolutionSnapshot {
    const snapshot = ProjectSkillResolutionSnapshotSchema.parse(value);
    const { checksum: signedChecksum, ...unsigned } = snapshot;
    if (projectSkillSnapshotChecksum(unsigned) !== signedChecksum) {
      throw new InternalServerErrorException({
        code: 'PROJECT_SKILL_SNAPSHOT_CORRUPT',
        msg: 'The frozen Skill snapshot failed integrity validation.',
      });
    }
    if (
      snapshot.ownerKind !== expected.ownerKind ||
      snapshot.projectId !== expected.projectId ||
      snapshot.scope !== expected.scope
    ) {
      throw new InternalServerErrorException({
        code: 'PROJECT_SKILL_SNAPSHOT_SCOPE_MISMATCH',
        msg: 'The frozen Skill snapshot belongs to a different project context.',
      });
    }
    return snapshot;
  }
}

function uniqueIds(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new InternalServerErrorException({
      code: 'PROJECT_SKILL_MANIFEST_INVALID',
      msg: `Published Skill manifest field ${field} is invalid.`,
    });
  }
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      throw new InternalServerErrorException({
        code: 'PROJECT_SKILL_MANIFEST_INVALID',
        msg: `Published Skill manifest field ${field} is invalid.`,
      });
    }
    result.push(item);
  }
  return result;
}

function recordValue(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InternalServerErrorException({
      code: 'PROJECT_SKILL_MANIFEST_INVALID',
      msg: `Published Skill manifest field ${field} is invalid.`,
    });
  }
  return value as Record<string, unknown>;
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
