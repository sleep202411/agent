import {
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { CrewQualificationsService } from '../crew-qualifications.service';
import { readTaskDeliveryTemplate } from './task-delivery-template';

type Db = Pick<
  Prisma.TransactionClient,
  '$queryRaw' | 'crewMember' | 'crewProductionPage'
>;
export function isCardDelivery(value: unknown): boolean {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { definition?: { approvalPolicy?: string } }).definition
      ?.approvalPolicy === 'fd3_or_production_lead'
  );
}
export const CARD_APPROVAL_POLICY = 'fd3_or_production_lead';
async function context(db: Db, crewId: string, taskId: string) {
  const template = await readTaskDeliveryTemplate(
    db as Prisma.TransactionClient,
    taskId,
  );
  if (template?.definition.approvalPolicy !== CARD_APPROVAL_POLICY) return null;
  const [members, page, artists] = await Promise.all([
    db.crewMember.findMany({
      where: { crewId, status: 'active' },
      select: { userId: true },
      orderBy: { userId: 'asc' },
    }),
    db.crewProductionPage.findUnique({
      where: { crewId },
      select: { leadMember: { select: { userId: true, status: true } } },
    }),
    db.$queryRaw<
      Array<{ userId: string }>
    >`SELECT DISTINCT a.user_id AS "userId"
      FROM crew_task_assignees a JOIN crew_tasks t ON t.id=a.task_id
      JOIN crew_task_delivery_templates d ON d.task_id=t.id
      JOIN crew_delivery_catalog_revisions r ON r.category_id=d.category_id AND r.version=d.category_version
      JOIN crew_task_workflow_states w ON w.id=t.workflow_state_id
      JOIN crew_members m ON m.id=a.crew_member_id
      WHERE t.crew_id=${crewId} AND t.deleted_at IS NULL AND w.semantic <> 'cancelled'
      AND m.status='active' AND r.definition->>'approvalPolicy'=${CARD_APPROVAL_POLICY}
      ORDER BY a.user_id`,
  ]);
  return {
    templateId: template.categoryId,
    templateVersion: template.version,
    members: members.map((x) => x.userId),
    artists: artists.map((x) => x.userId),
    lead: page?.leadMember?.status === 'active' ? page.leadMember.userId : null,
  };
}
export async function prepareCardApproval(
  db: Db,
  crewId: string,
  taskId: string,
  reviewer: string,
  cookie?: string,
  qualifications = new CrewQualificationsService(),
) {
  const initial = await context(db, crewId, taskId);
  if (!initial)
    throw new ConflictException(
      'Card-generation delivery requirements changed. Refresh the task.',
    );
  const started = Date.now();
  const hasFd3 = async (userId: string) => {
    try {
      await qualifications.assertEligible(userId, cookie, {
        experienceLevel: 'senior',
        requiredSkills: [],
      });
      return true;
    } catch (error) {
      if (
        error instanceof ForbiddenException &&
        typeof error.getResponse() === 'object' &&
        (error.getResponse() as { code?: string }).code ===
          'CREW_QUALIFICATIONS_REQUIRED'
      )
        return false;
      throw error;
    }
  };
  if (!initial.members.includes(reviewer))
    throw new ForbiddenException('An active project reviewer is required.');
  let method: 'fd3' | 'production_lead' = 'fd3';
  if (!(await hasFd3(reviewer))) {
    method = 'production_lead';
    if (initial.lead !== reviewer || initial.artists.length !== 1)
      throw new ForbiddenException(
        'Card-generation work requires FD3 approval. The production lead may approve only when this project has no FD3 member and exactly one card artist.',
      );
    if (initial.members.length > 100)
      throw new ServiceUnavailableException(
        'Use an FD3 reviewer; this project is too large for the production-lead qualification check.',
      );
    const others = initial.members.filter((id) => id !== reviewer);
    for (let i = 0; i < others.length; i += 5) {
      if ((await Promise.all(others.slice(i, i + 5).map(hasFd3))).some(Boolean))
        throw new ForbiddenException(
          'This project has an FD3-qualified member. An FD3 reviewer must approve this work.',
        );
    }
  }
  return {
    evidence: {
      policy: CARD_APPROVAL_POLICY,
      method,
      reviewerUserId: reviewer,
      verifiedAt: new Date(started).toISOString(),
    },
    async validate(tx: Db) {
      if (
        Date.now() - started > 60_000 ||
        JSON.stringify(await context(tx, crewId, taskId)) !==
          JSON.stringify(initial)
      )
        throw new ConflictException(
          'Project membership, director or delivery requirements changed. Refresh and review again.',
        );
    },
  };
}
