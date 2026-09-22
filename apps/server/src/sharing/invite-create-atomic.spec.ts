import { WorkspaceInvitesService } from './workspace-invites.service';
import { ProjectInvitesService } from './project-invites.service';
import { PlatformAuditLogService } from '../workspaces/audit-log.service';
import { hashInviteToken } from './invite-token';

type Row = Record<string, unknown>;
function fixture(scope: 'workspace' | 'project') {
  const committed: Row[] = [];
  let failAudit = true;
  const client = (rows: Row[]) => ({
    workspace: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'workspace', name: 'Fixture' }),
    },
    [`${scope}Invite`]: {
      create: jest.fn(({ data }: { data: Row }) => {
        const row = { id: 'invite', ...data };
        rows.push(row);
        return Promise.resolve(row);
      }),
    },
    platformAuditLog: {
      create: jest.fn(({ data }: { data: Row }) => {
        if (failAudit) return Promise.reject(new Error('audit unavailable'));
        rows.push({ audit: true, ...data });
        return Promise.resolve(data);
      }),
    },
  });
  const db = {
    ...client(committed),
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => {
      const pending: Row[] = [];
      const result = await work(client(pending));
      committed.push(...pending);
      return result;
    },
  };
  const permissions = {
    requireWorkspaceRole: jest.fn().mockResolvedValue({}),
    requireProjectRole: jest
      .fn()
      .mockResolvedValue({ id: 'project', workspaceId: 'workspace' }),
  };
  const audit = new PlatformAuditLogService(db as never);
  const Service =
    scope === 'workspace' ? WorkspaceInvitesService : ProjectInvitesService;
  const service = new Service(
    db as never,
    permissions as never,
    audit,
    {} as never,
  );
  return {
    committed,
    service,
    allowAudit: () => {
      failAudit = false;
    },
  };
}

describe.each(['workspace', 'project'] as const)(
  '%s invite creation atomicity',
  (scope) => {
    it('leaves no stored invite on audit failure and permits a clean retry', async () => {
      const f = fixture(scope);
      const create = () =>
        f.service.create(scope, { userId: 'admin' } as never, {
          role: 'editor',
          expiresInDays: 7,
        });
      await expect(create()).rejects.toThrow('audit unavailable');
      expect(f.committed).toEqual([]);
      f.allowAudit();
      const result = await create();
      expect(f.committed).toHaveLength(2);
      expect(f.committed[0]).toMatchObject({
        id: result.inviteId,
        tokenHash: hashInviteToken(result.token),
      });
      expect(f.committed[0]).not.toHaveProperty('token');
      expect(f.committed[1]).toMatchObject({
        audit: true,
        entityId: result.inviteId,
      });
    });
  },
);
