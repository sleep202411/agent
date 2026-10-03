import { WorkspaceInvitesService } from './workspace-invites.service';
import { ProjectInvitesService } from './project-invites.service';
import { StoryProjectInvitesService } from '../story-studio/story-project-invites.service';

jest.mock('./seat-guard', () => ({
  ...jest.requireActual<typeof import('./seat-guard')>('./seat-guard'),
  acquireSeatLock: jest.fn(),
  assertCreatorSeatAvailable: jest.fn(),
}));
jest.mock('./team-realtime', () => ({ enqueueTeamMemberChanged: jest.fn() }));

function fixture(
  scope: 'workspace' | 'project' | 'story',
  expiresAt: Date | null,
) {
  const invite = {
    id: 'invite',
    workspaceId: 'workspace',
    projectId: 'project',
    storyProjectId: 'story',
    role: scope === 'story' ? 'producer' : 'editor',
    status: 'pending',
    expiresAt,
    invitedById: 'owner',
    invitedByUserId: 'owner',
  };
  const target = {
    id: 'target',
    workspaceId: 'workspace',
    name: 'Project',
    title: 'Project',
  };
  const member = () => ({
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({
      id: 'member',
      userId: 'recipient',
      role: invite.role,
    }),
  });
  const invitation = () => ({
    findUnique: jest.fn().mockResolvedValue(invite),
    update: jest.fn(),
  });
  const row = { status: 'pending', expires_at: expiresAt };
  const db = {
    workspace: { findFirst: jest.fn().mockResolvedValue(target) },
    platformProject: { findFirst: jest.fn().mockResolvedValue(target) },
    storyProject: { findFirst: jest.fn().mockResolvedValue(target) },
    workspaceMember: member(),
    projectMember: member(),
    storyProjectMember: member(),
    workspaceInvite: invitation(),
    projectInvite: invitation(),
    storyProjectInvite: invitation(),
    $queryRaw: jest.fn().mockImplementation(() => Promise.resolve([row])),
  };
  const prisma = {
    ...db,
    $transaction: (work: (tx: typeof db) => Promise<unknown>) => work(db),
  };
  const audit = { record: jest.fn() };
  const service =
    scope === 'workspace'
      ? new WorkspaceInvitesService(
          prisma as never,
          {} as never,
          audit as never,
          {} as never,
        )
      : scope === 'project'
        ? new ProjectInvitesService(
            prisma as never,
            {} as never,
            audit as never,
            {} as never,
          )
        : new StoryProjectInvitesService(
            prisma as never,
            {} as never,
            audit as never,
            { send: jest.fn() } as never,
            {} as never,
          );
  const membership =
    scope === 'workspace'
      ? db.workspaceMember
      : scope === 'project'
        ? db.projectMember
        : db.storyProjectMember;
  return {
    row,
    db,
    membership,
    accept: () =>
      service.accept(invite as never, { userId: 'recipient' } as never),
  };
}

describe.each(['workspace', 'project', 'story'] as const)(
  '%s invite acceptance expiry',
  (scope) => {
    it.each([null, new Date('2099-01-01')])(
      'creates membership for an active link with expiry %s',
      async (expiresAt) => {
        const t = fixture(scope, expiresAt);
        await expect(t.accept()).resolves.toMatchObject({
          workspaceId: 'workspace',
        });
        expect(t.membership.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              userId: 'recipient',
              role: scope === 'story' ? 'producer' : 'editor',
            }) as unknown,
          }),
        );
        if (scope !== 'workspace')
          expect(t.db.workspaceMember.create).toHaveBeenCalledWith(
            expect.objectContaining({
              data: expect.objectContaining({
                accessScope: 'project_only',
              }) as unknown,
            }),
          );
      },
    );
    it.each(['revoked', 'expired', 'missing'] as const)(
      'rejects a link that becomes %s before the row lock',
      async (state) => {
        const t = fixture(scope, null);
        if (state === 'revoked') t.row.status = 'revoked';
        if (state === 'expired') t.row.expires_at = new Date('2000-01-01');
        if (state === 'missing') t.db.$queryRaw.mockResolvedValue([]);
        await expect(t.accept()).rejects.toMatchObject({
          response: { code: 'INVITE_NOT_ACTIVE' },
        });
        expect(t.membership.create).not.toHaveBeenCalled();
      },
    );
  },
);
