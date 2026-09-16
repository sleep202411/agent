/**
 * The one way an invited account becomes a crew member.
 *
 * Joining is not a single insert: it opens the crew conversation, creates the
 * membership, grants the additive policies the inviter chose, writes the
 * authorization event, hands out collaboration access, and adds the person to
 * the conversation. A named invitation and an open invite link differ only in
 * what authorized the join — everything after that must stay identical, so both
 * call this instead of keeping their own copy in step.
 *
 * Runs inside the caller's transaction. The system message is returned rather
 * than broadcast: the caller broadcasts after commit, so a rolled-back join
 * cannot announce itself.
 */
import { ConflictException } from '@nestjs/common';
import { CrewMembershipStatus, Prisma, type Message } from '@prisma/client';
import { isCrewPolicyKey } from '@repo/shared/crew';
import { ConversationsService } from '../../conversations/conversations.service';
import { CrewCollaborationService } from '../collaboration/crew-collaboration.service';
import { newCrewDomainId } from '../id';

export interface CrewJoinDeps {
  conversations: ConversationsService;
  collaboration: CrewCollaborationService;
}

export interface CrewJoinInput {
  crewId: string;
  userId: string;
  /** Additive access, fixed by whoever authorized the join. */
  policyKeys: readonly string[];
  /** The inviter, or the account that minted the link. */
  grantedByUserId: string;
  /** Audit action — this is where a link join stays distinguishable. */
  action: string;
  /** Extra audit payload; merged after the shared policy record. */
  auditAfter?: Record<string, unknown>;
}

export async function joinCrewInTransaction(
  tx: Prisma.TransactionClient,
  deps: CrewJoinDeps,
  input: CrewJoinInput,
): Promise<{ memberId: string; systemMessage: Message }> {
  // Named invitations and distinct invite links have separate caller locks.
  // Serialize their shared membership admission before checking for a winner.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:invite-membership:${input.crewId}:${input.userId}`}, 0))`;
  const existing = await tx.crewMember.findFirst({
    where: {
      crewId: input.crewId,
      userId: input.userId,
      status: {
        in: [CrewMembershipStatus.active, CrewMembershipStatus.suspended],
      },
    },
  });
  if (existing) {
    throw new ConflictException({
      message: 'This account already has an active crew membership.',
    });
  }

  const conversation = await deps.conversations.openCrewConversation(
    input.crewId,
    tx,
  );
  const member = await tx.crewMember.create({
    data: {
      id: newCrewDomainId(),
      crewId: input.crewId,
      userId: input.userId,
      status: CrewMembershipStatus.active,
      joinedVia: 'invitation',
    },
  });
  const policyKeys = [...new Set(input.policyKeys.filter(isCrewPolicyKey))];
  if (policyKeys.length > 0) {
    await tx.crewMemberPolicy.createMany({
      data: policyKeys.map((policyKey) => ({
        memberId: member.id,
        policyKey,
        assignedByUserId: input.grantedByUserId,
      })),
    });
  }
  await tx.crewAuthorizationEvent.create({
    data: {
      crewId: input.crewId,
      memberId: member.id,
      actorUserId: input.userId,
      action: input.action,
      after: { policyKeys, ...(input.auditAfter ?? {}) },
    },
  });
  await deps.collaboration.addCrewMemberAccess(
    input.crewId,
    input.userId,
    input.grantedByUserId,
    tx,
  );
  await deps.conversations.syncCrewParticipant(
    input.crewId,
    input.userId,
    'join',
    tx,
  );
  const systemMessage = await deps.conversations.persistSystem(
    conversation.id,
    'crew.member.joined',
    { userId: input.userId },
    tx,
  );
  return { memberId: member.id, systemMessage };
}
