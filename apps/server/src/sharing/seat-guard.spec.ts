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

/** After the legacy personal allowance cutoff. */
const CREATED_AFTER_CUTOFF = new Date('2026-08-12T00:00:01+08:00');
/** Before it — the grandfathered era, when teams could not hold a second creator. */
const CREATED_BEFORE_CUTOFF = new Date('2026-07-10T09:03:27Z');
/** The grace day itself: shipped 08-11, so this must still be grandfathered. */
const CREATED_ON_GRACE_DAY = new Date('2026-08-11T18:00:00+08:00');

function txFor(input: {
  type: WorkspaceType;
  creatorUserIds: string[];
  createdAt?: Date;
}) {
  return {
    $queryRaw: jest
      .fn()
      .mockResolvedValue(input.creatorUserIds.map((user_id) => ({ user_id }))),
    entitlementGrant: { findMany: jest.fn().mockResolvedValue([]) },
    billingMembershipPlan: { findMany: jest.fn().mockResolvedValue([]) },
    workspace: {
      findUnique: jest.fn().mockResolvedValue({
        type: input.type,
        createdAt: input.createdAt ?? CREATED_AFTER_CUTOFF,
      }),
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

  it('admits a second creator in a NEW no-plan PERSONAL workspace during open collaboration', async () => {
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
    ).resolves.toBeUndefined();
  });

  /**
   * Grandfathering. Before 2026-08-11 a free team was owner-only, so every
   * collaborative project ended up in someone's personal workspace — 虎豹花园 is
   * seven projects across four of them. Both old and new workspaces now keep
   * collaborating without a seat cap.
   */
  it('admits a second creator in a PERSONAL workspace from before the cutoff', async () => {
    await expect(
      assertCreatorSeatAvailable(
        txFor({
          type: WorkspaceType.personal,
          creatorUserIds: ['owner-1'],
          createdAt: CREATED_BEFORE_CUTOFF,
        }),
        WORKSPACE_ID,
        'editor-2',
        entitlements,
      ),
    ).resolves.toBeUndefined();
  });

  /** The change shipped on 08-11, so that whole day is inside the grace period. */
  it('grandfathers a PERSONAL workspace created on the day the change shipped', async () => {
    await expect(
      assertCreatorSeatAvailable(
        txFor({
          type: WorkspaceType.personal,
          creatorUserIds: ['owner-1'],
          createdAt: CREATED_ON_GRACE_DAY,
        }),
        WORKSPACE_ID,
        'editor-2',
        entitlements,
      ),
    ).resolves.toBeUndefined();
  });

  it('admits creators beyond the legacy PERSONAL allowance', async () => {
    await expect(
      assertCreatorSeatAvailable(
        txFor({
          type: WorkspaceType.personal,
          creatorUserIds: Array.from({ length: 28 }, (_, i) => `user-${i}`),
          createdAt: CREATED_BEFORE_CUTOFF,
        }),
        WORKSPACE_ID,
        'editor-29',
        entitlements,
      ),
    ).resolves.toBeUndefined();
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

  it('admits the 29th creator in a no-plan TEAM workspace', async () => {
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
    ).resolves.toBeUndefined();
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
