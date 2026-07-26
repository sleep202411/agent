import { WorkspaceType } from '@prisma/client';
import { EntitlementService } from '../entitlements/entitlement.service';
import { assertSeatAvailable } from './seat-guard';

const WORKSPACE_ID = '0197f4a2-0800-7000-8000-000000000001';

/**
 * The real resolver + the real decision, so these pin the seat allowance a
 * member-add actually hits — not just the constants in isolation.
 */
function txFor(input: { type: WorkspaceType; activeSeats: number }) {
  return {
    entitlementGrant: { findMany: jest.fn().mockResolvedValue([]) },
    billingMembershipPlan: { findMany: jest.fn().mockResolvedValue([]) },
    workspace: {
      findUnique: jest.fn().mockResolvedValue({ type: input.type }),
    },
    workspaceMember: {
      count: jest.fn().mockResolvedValue(input.activeSeats),
    },
  } as never;
}

describe('assertSeatAvailable on a workspace with no plan', () => {
  const entitlements = new EntitlementService({} as never);

  it('admits collaborators into a personal workspace up to 5 seats', async () => {
    // 4 seats taken (owner + 3) → the 5th occupant still fits.
    await expect(
      assertSeatAvailable(
        txFor({ type: WorkspaceType.personal, activeSeats: 4 }),
        WORKSPACE_ID,
        entitlements,
      ),
    ).resolves.toBeUndefined();
  });

  it('refuses the 6th member of a personal workspace', async () => {
    await expect(
      assertSeatAvailable(
        txFor({ type: WorkspaceType.personal, activeSeats: 5 }),
        WORKSPACE_ID,
        entitlements,
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'WORKSPACE_SEAT_LIMIT_REACHED',
        includedSeats: 5,
        activeSeats: 5,
      },
    });
  });

  it('still refuses a second member of a TEAM workspace whose plan lapsed', async () => {
    await expect(
      assertSeatAvailable(
        txFor({ type: WorkspaceType.team, activeSeats: 1 }),
        WORKSPACE_ID,
        entitlements,
      ),
    ).rejects.toMatchObject({
      response: { code: 'WORKSPACE_SEAT_LIMIT_REACHED', includedSeats: 1 },
    });
  });
});
