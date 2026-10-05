import { provisionTaskDeliveryFolderTx } from './tasks/task-delivery-folder';
import { bindTaskDeliveryCategoryKey } from './production/production-bootstrap';
import { CrewTaskKind } from '@prisma/client';
import { availableCrewAssetName } from './assets/asset-name';
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
    // An explicitly supplied canvas is a requested import. An empty crew must
    // remain empty until the creator reviews and confirms tasks in the workbench.
    if (
      productionKind === CrewProductionKind.interactive_film &&
      (input.plotTree ||
        Object.keys(input.storyboardClipsByNode ?? {}).length > 0)
    ) {
      await seedCrewProductionTasks(tx, {
        crewId: c.id,
        userId: creatorUserId,
        episodeId,
        kind: productionKind,
        locale: input.productionTemplateLocale,
        openWorkflowStateId,
        plotTree: input.plotTree,
      });
    }
    await seedCrewTaskKindTemplates(tx, {
      crewId: c.id,
      userId: creatorUserId,
      locale: input.productionTemplateLocale,
    });

    if (
      productionKind === CrewProductionKind.interactive_film &&
      input.storyboardClipsByNode &&
      Object.keys(input.storyboardClipsByNode).length > 0
    ) {
      const plotNodeTasks = await tx.crewTask.findMany({
        where: {
          crewId: c.id,
          parentId: { not: null },
          metadata: { path: ['plotTreeNodeId'], not: Prisma.DbNull },
          deletedAt: null,
        },
      });

      const plotNodeTaskMap = new Map<string, (typeof plotNodeTasks)[0]>();
      for (const t of plotNodeTasks) {
        const meta = t.metadata as Record<string, unknown> | null;
        if (meta && typeof meta.plotTreeNodeId === 'string') {
          plotNodeTaskMap.set(meta.plotTreeNodeId, t);
        }
      }

      // If plotNodeTasks are empty but an episode storyboard task exists,
      // resolve the episode storyboard task
      const episodeTask = await tx.crewTask.findFirst({
        where: {
          crewId: c.id,
          deletedAt: null,
          taskKind: CrewTaskKind.storyboard,
          parentId: { not: null },
        },
      });

      const maxNumberRow = await tx.crewTask.findFirst({
        where: { crewId: c.id },
        orderBy: { number: 'desc' },
        select: { number: true },
      });
      let nextNumber = (maxNumberRow?.number ?? 0) + 1;

      const maxRankRow = await tx.crewTask.findFirst({
        where: { crewId: c.id },
        orderBy: { rank: 'desc' },
        select: { rank: true },
      });
      let currentRank = maxRankRow?.rank
        ? new Prisma.Decimal(maxRankRow.rank).plus(1024)
        : new Prisma.Decimal(1024);

      for (const [nodeId, clips] of Object.entries(
        input.storyboardClipsByNode,
      )) {
        let parentTask = plotNodeTaskMap.get(nodeId);

        if (!parentTask && episodeTask) {
          // If the plot-node child task doesn't exist yet, lazily create it under the episode task
          const existingNodeChild = await tx.crewTask.findFirst({
            where: {
              crewId: c.id,
              deletedAt: null,
              metadata: { path: ['plotTreeNodeId'], equals: nodeId },
            },
          });
          if (existingNodeChild) {
            parentTask = existingNodeChild;
            plotNodeTaskMap.set(nodeId, existingNodeChild);
          } else {
            const nodeTitle = 'Node: ' + nodeId;
            parentTask = await tx.crewTask.create({
              data: {
                id: randomUUID(),
                crewId: c.id,
                parentId: episodeTask.id,
                number: nextNumber++,
                title: nodeTitle,
                description: '',
                workflowStateId: openWorkflowStateId,
                taskKind: CrewTaskKind.storyboard,
                episodeId: episodeTask.episodeId,
                rank: currentRank,
                createdByUserId: creatorUserId,
                metadata: { plotTreeNodeId: nodeId },
              },
            });
            await provisionTaskDeliveryFolderTx(tx, parentTask, creatorUserId);
            currentRank = currentRank.plus(1024);
            plotNodeTaskMap.set(nodeId, parentTask);
          }
        }

        if (!parentTask) continue;

        const sortedClips = [...clips].sort((a, b) => a.order - b.order);

        for (const clip of sortedClips) {
          const existingShot = await tx.crewTask.findFirst({
            where: {
              crewId: c.id,
              deletedAt: null,
              metadata: { path: ['clipId'], equals: clip.clipId },
            },
          });
          if (existingShot) continue;

          const shotTitle = clip.title?.trim()
            ? clip.title
            : input.productionTemplateLocale === 'en-US'
              ? 'Shot ' + (clip.order + 1)
              : '第 ' + (clip.order + 1) + ' 镜';

          const taskId = randomUUID();

          // Create a delivery folder for the shot task
          const existingFolders = await tx.crewAssetNode.findMany({
            where: { crewId: c.id, parentId: null, status: 'active' },
            select: { name: true },
          });
          const folderName = availableCrewAssetName(
            shotTitle,
            new Set(existingFolders.map((f) => f.name.toLowerCase())),
          );
          const deliveryFolder = await tx.crewAssetNode.create({
            data: {
              id: randomUUID(),
              crewId: c.id,
              kind: 'folder',
              name: folderName,
              createdByUserId: creatorUserId,
              updatedByUserId: creatorUserId,
            },
          });

          const shotTask = await tx.crewTask.create({
            data: {
              id: taskId,
              crewId: c.id,
              parentId: parentTask.id,
              number: nextNumber++,
              title: shotTitle,
              description: '',
              workflowStateId: openWorkflowStateId,
              taskKind: CrewTaskKind.storyboard,
              episodeId: parentTask.episodeId,
              rank: currentRank,
              createdByUserId: creatorUserId,
              metadata: {
                clipId: clip.clipId,
                plotTreeNodeId: nodeId,
                order: clip.order,
                durationSeconds: clip.durationSeconds,
              },
            },
          });
          currentRank = currentRank.plus(1024);

          await tx.crewTaskDeliveryFolder.create({
            data: {
              taskId: shotTask.id,
              crewId: c.id,
              folderId: deliveryFolder.id,
              createdByUserId: creatorUserId,
            },
          });
          await bindTaskDeliveryCategoryKey(tx, shotTask.id, 'shot_delivery');
        }
      }
    }
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
