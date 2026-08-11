import {
  ProjectMemberRole,
  StoryProjectMemberRole,
  WorkspaceMemberRole,
  WorkspaceType,
} from '@prisma/client';
import { EntitlementService } from '../entitlements/entitlement.service';
import {
  assertCreatorSeatAvailable,
  projectRoleConsumesCreatorSeat,
  storyRoleConsumesCreatorSeat,
  workspaceRoleConsumesCreatorSeat,
} from './seat-guard';

const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000001';

function txFor(input: { type: WorkspaceType; creatorUserIds: string[] }) {
  return {
    $queryRaw: jest
      .fn()
      .mockResolvedValue(input.creatorUserIds.map((user_id) => ({ user_id }))),
    entitlementGrant: { findMany: jest.fn().mockResolvedValue([]) },
    billingMembershipPlan: { findMany: jest.fn().mockResolvedValue([]) },
    workspace: {
      findUnique: jest.fn().mockResolvedValue({ type: input.type }),
    },
  } as never;
}

describe('creator seat enforcement', () => {
  const entitlements = new EntitlementService({} as never);

  it('counts one user only once across multiple projects', async () => {
    await expect(
      assertCreatorSeatAvailable(
        txFor({
          type: WorkspaceType.personal,
          creatorUserIds: ['owner-1'],
        }),
        WORKSPACE_ID,
        'owner-1',
        entitlements,
      ),
    ).resolves.toBeUndefined();
  });

  it('blocks a second creator in a no-plan PERSONAL workspace', async () => {
    await expect(
      assertCreatorSeatAvailable(
        txFor({
          type: WorkspaceType.personal,
          creatorUserIds: ['owner-1'],
        }),
        WORKSPACE_ID,
        'editor-2',
        entitlements,
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'WORKSPACE_CREATOR_SEAT_LIMIT_REACHED',
        includedSeats: 1,
        activeSeats: 1,
      },
    });
  });

  /**
   * A team with no plan is the ordinary case (creating one is ungated), and it
   * has to work: this used to reject, which is why every team on .com sat at one
   * member. The invitee was the one who found out, at accept time.
   */
  it('admits a second creator in a no-plan TEAM workspace', async () => {
    await expect(
      assertCreatorSeatAvailable(
        txFor({
          type: WorkspaceType.team,
          creatorUserIds: ['owner-1'],
        }),
        WORKSPACE_ID,
        'editor-2',
        entitlements,
      ),
    ).resolves.toBeUndefined();
  });

  it('still blocks the 29th creator in a no-plan TEAM workspace', async () => {
    await expect(
      assertCreatorSeatAvailable(
        txFor({
          type: WorkspaceType.team,
          creatorUserIds: Array.from({ length: 28 }, (_, i) => `user-${i}`),
        }),
        WORKSPACE_ID,
        'editor-29',
        entitlements,
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'WORKSPACE_CREATOR_SEAT_LIMIT_REACHED',
        includedSeats: 28,
        activeSeats: 28,
      },
    });
  });

  it('does not classify viewer/reviewer/billing roles as creator seats', () => {
    expect(workspaceRoleConsumesCreatorSeat(WorkspaceMemberRole.billing)).toBe(
      false,
    );
    expect(workspaceRoleConsumesCreatorSeat(WorkspaceMemberRole.viewer)).toBe(
      false,
    );
    expect(projectRoleConsumesCreatorSeat(ProjectMemberRole.viewer)).toBe(
      false,
    );
    expect(storyRoleConsumesCreatorSeat(StoryProjectMemberRole.reviewer)).toBe(
      false,
    );
    expect(storyRoleConsumesCreatorSeat(StoryProjectMemberRole.viewer)).toBe(
      false,
    );
  });
});
