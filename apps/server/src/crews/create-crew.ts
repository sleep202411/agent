import { createCrewStudioWorkspaceTx } from './production/create-studio-workspace';
import { randomUUID } from 'node:crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  CrewMembershipStatus,
  CrewProductionKind,
  Prisma,
} from '@prisma/client';
import type { ConversationsService } from '../conversations/conversations.service';
import type { CreateCrewInput } from './dto';
import { newCrewDomainId, newCrewId } from './id';
import {
  seedCrewProductionFolders,
  seedCrewProductionTasks,
  seedCrewTaskKindTemplates,
} from './production/production-bootstrap';
import { workspaceLinkableWhere } from './production/studio-workspace.service';
import {
  CREW_PRODUCTION_TEMPLATE_VERSION,
  createDefaultProductionDocument,
  createDefaultProductionPlan,
} from './production/production-document';
import {
  DEFAULT_CREW_TASK_WORKFLOW_STATES,
  defaultCrewTaskView,
} from './tasks/task-defaults';

/** Caller enforces creation eligibility. All ownership, task and chat writes share its transaction. */
export async function createCrewTx(
  tx: Prisma.TransactionClient,
  conversations: ConversationsService,
  creatorUserId: string,
  input: CreateCrewInput,
  listingStatus: 'listed' | 'unlisted' = 'listed',
) {
  const productionPlan = createDefaultProductionPlan(
    input.productionTemplateLocale,
  );
  const productionKind = input.productionKind ?? CrewProductionKind.series;
  const studioWorkspaceId = await resolveStudioWorkspaceId(
    tx,
    creatorUserId,
    input,
  );
  const c = await tx.crew.create({
    data: {
      id: newCrewId(),
      name: input.name,
      description: input.description,
      logo: input.logo,
      productionKind,
      studioWorkspaceId,
      tagline: input.tagline ?? null,
      genres: input.genres,
      styles: input.styles,
      // Empty arrays come through as SQL NULL — Prisma's JsonB
      // column requires Prisma.DbNull for the null literal.
      ...(input.socialLinks.length > 0
        ? { socialLinks: input.socialLinks }
        : { socialLinks: Prisma.DbNull }),
      ...(input.showcaseWorks.length > 0
        ? { showcaseWorks: input.showcaseWorks }
        : { showcaseWorks: Prisma.DbNull }),
      createdByUserId: creatorUserId,
      // Manual creation is public; private-IP creation explicitly opts out.
      listingStatus,
      listedAt: listingStatus === 'listed' ? new Date() : null,
      productionPage: {
        create: {
          document: createDefaultProductionDocument(
            input.productionTemplateLocale,
          ),
          createdByUserId: creatorUserId,
          updatedByUserId: creatorUserId,
        },
      },
      productionActivity: {
        create: {
          kind: 'project_created',
          createdByUserId: creatorUserId,
          payload: {
            productionTemplateVersion: CREW_PRODUCTION_TEMPLATE_VERSION,
            productionTemplateLocale: input.productionTemplateLocale,
            productionKind,
            studioWorkspaceId,
          },
        },
      },
    },
  });
  const ownerMember = await tx.crewMember.create({
    data: {
      id: newCrewDomainId(),
      crewId: c.id,
      userId: creatorUserId,
      status: CrewMembershipStatus.active,
      joinedVia: 'creation',
    },
  });
  await tx.crewOwnership.create({
    data: { crewId: c.id, memberId: ownerMember.id },
  });
  const workflowStateIds = new Map(
    DEFAULT_CREW_TASK_WORKFLOW_STATES.map((state) => [
      state.systemKey,
      randomUUID(),
    ]),
  );
  await tx.crewTaskWorkflowState.createMany({
    data: DEFAULT_CREW_TASK_WORKFLOW_STATES.map((state) => ({
      id: workflowStateIds.get(state.systemKey)!,
      crewId: c.id,
      name: state.name,
      color: state.color,
      semantic: state.semantic,
      systemKey: state.systemKey,
      position: state.position,
      createdByUserId: creatorUserId,
    })),
  });
  await tx.crewTaskView.create({
    data: defaultCrewTaskView(c.id, creatorUserId),
  });

  const episodeId = randomUUID();
  await tx.crewEpisode.create({
    data: {
      id: episodeId,
      crewId: c.id,
      number: 1,
      title: productionPlan.episode.title,
      synopsis: productionPlan.episode.synopsis,
      status: 'planned',
      rank: 1024,
      createdByUserId: creatorUserId,
    },
  });

  // One crew, one group chat — opened with the crew so there is
  // never a window where a member exists without a thread to talk
  // in. No `crew.member.joined` system message here on purpose:
  // the founder joining the crew they just created, into a chat
  // with no other reader, is not an event — the chat's existence
  // already says it. Every LATER join announces itself.
  const openWorkflowStateId = workflowStateIds.get('open');
  if (openWorkflowStateId) {
    await seedCrewProductionFolders(tx, {
      crewId: c.id,
      userId: creatorUserId,
      kind: productionKind,
      locale: input.productionTemplateLocale,
    });
    await seedCrewProductionTasks(tx, {
      crewId: c.id,
      userId: creatorUserId,
      episodeId,
      kind: productionKind,
      locale: input.productionTemplateLocale,
      openWorkflowStateId,
    });
    await seedCrewTaskKindTemplates(tx, {
      crewId: c.id,
      userId: creatorUserId,
      locale: input.productionTemplateLocale,
    });
  }

  await conversations.openCrewConversation(c.id, tx);
  await conversations.syncCrewParticipant(c.id, creatorUserId, 'join', tx);
  return tx.crew.findUniqueOrThrow({
    where: { id: c.id },
    include: {
      ownership: { include: { member: { select: { userId: true } } } },
    },
  });
}

async function resolveStudioWorkspaceId(
  tx: Prisma.TransactionClient,
  userId: string,
  input: CreateCrewInput,
): Promise<string | null> {
  if (input.studioWorkspaceId && input.createStudioWorkspace) {
    throw new BadRequestException(
      'Choose an existing workspace or create a new one, not both.',
    );
  }
  if (input.createStudioWorkspace) {
    const created = await createCrewStudioWorkspaceTx(
      tx,
      userId,
      input.createStudioWorkspace.name,
    );
    return created.id;
  }
  if (!input.studioWorkspaceId) return null;

  const workspace = await tx.workspace.findFirst({
    where: {
      id: input.studioWorkspaceId,
      ...workspaceLinkableWhere(userId),
    },
    select: { id: true },
  });
  if (!workspace) throw new NotFoundException('Workspace not found.');
  return workspace.id;
}
