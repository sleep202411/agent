import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { WorkspacePermissionService } from './workspace-permission.service';
const requireModule = process
  .getBuiltinModule('module')
  .createRequire(__filename);
const { PGlite } = requireModule(
  '@electric-sql/pglite',
) as typeof import('@electric-sql/pglite');
const { PGLiteSocketServer } = requireModule(
  '@electric-sql/pglite-socket',
) as typeof import('@electric-sql/pglite-socket');

/** Real Prisma queries against a disposable in-memory PostgreSQL engine.
 * No environment URL is read; the only socket is inside this test's temp directory.
 */
describe('linked Crew workspace authorization (Prisma + PGlite)', () => {
  const workspaceId = '01990000-0000-7000-8000-000000000001';
  let directory: string;
  let sql: InstanceType<typeof PGlite>;
  let server: InstanceType<typeof PGLiteSocketServer>;
  let prisma: PrismaClient;
  let permissions: WorkspacePermissionService;
  beforeAll(async () => {
    // Keep the Unix socket path below macOS's 104-byte limit.
    directory = await mkdtemp('/tmp/crew-access-');
    sql = await PGlite.create();
    await sql.exec(`
      CREATE TYPE "WorkspaceStatus" AS ENUM ('active','archived');
      CREATE TYPE "CrewMembershipStatus" AS ENUM ('active','suspended','removed');
      CREATE TYPE "CrewPermissionEffect" AS ENUM ('allow','deny');
      CREATE TYPE "WorkspaceMemberRole" AS ENUM ('owner','admin','editor','viewer','billing');
      CREATE TYPE "WorkspaceMemberStatus" AS ENUM ('invited','active','suspended','removed');
      CREATE TYPE "WorkspaceMemberAccessScope" AS ENUM ('workspace','project_only');
      CREATE TABLE workspaces(id uuid PRIMARY KEY, status "WorkspaceStatus", deleted_at timestamptz);
      CREATE TABLE crews(id text PRIMARY KEY, studio_workspace_id uuid, deleted_at timestamptz);
      CREATE TABLE crew_members(id text PRIMARY KEY, crew_id text, user_id text, status "CrewMembershipStatus");
      CREATE TABLE crew_ownership(crew_id text PRIMARY KEY, member_id text);
      CREATE TABLE crew_member_policies(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), member_id text, policy_key text);
      CREATE TABLE crew_member_permission_overrides(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), member_id text, permission_key text, effect "CrewPermissionEffect");
      CREATE TABLE workspace_members(
        id uuid PRIMARY KEY, workspace_id uuid, user_id text,
        role "WorkspaceMemberRole", status "WorkspaceMemberStatus", access_scope "WorkspaceMemberAccessScope",
        invited_by_id text, joined_at timestamptz DEFAULT now(), removed_at timestamptz,
        created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
      );
    `);
    server = new PGLiteSocketServer({
      db: sql,
      path: join(directory, '.s.PGSQL.5432'),
    });
    await new Promise<void>((resolve, reject) => {
      server.addEventListener(
        'error',
        (event) => {
          const cause: unknown = event.detail;
          reject(cause instanceof Error ? cause : new Error(String(cause)));
        },
        { once: true },
      );
      void server.start().then(resolve, reject);
    });
    prisma = new PrismaClient({
      adapter: new PrismaPg({
        host: directory,
        port: 5432,
        database: 'postgres',
        user: 'postgres',
        max: 1,
      }),
    });
    permissions = new WorkspacePermissionService(prisma as never);
  }, 30000);
  beforeEach(async () => {
    await sql.exec(
      'TRUNCATE workspace_members, crew_member_permission_overrides, crew_member_policies, crew_ownership, crew_members, crews, workspaces',
    );
    await sql.query("INSERT INTO workspaces VALUES ($1,'active',NULL)", [
      workspaceId,
    ]);
    await sql.query("INSERT INTO crews VALUES ('crew',$1,NULL)", [workspaceId]);
    await sql.exec(
      "INSERT INTO crew_members VALUES ('member','crew','user','active')",
    );
  });
  afterAll(async () => {
    await prisma?.$disconnect();
    await server?.stop();
    await sql?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('resolves read/edit grants and explicit denials with real relation predicates', async () => {
    await expect(
      permissions.requireWorkspaceRole('user', workspaceId, 'viewer'),
    ).resolves.toMatchObject({ role: 'viewer' });
    await expect(
      permissions.requireWorkspaceRole('user', workspaceId, 'editor'),
    ).rejects.toMatchObject({
      response: { code: 'WORKSPACE_PERMISSION_DENIED' },
    });
    await sql.exec(
      "INSERT INTO crew_member_policies(member_id,policy_key) VALUES ('member','admin')",
    );
    await expect(
      permissions.requireWorkspaceRole('user', workspaceId, 'editor'),
    ).resolves.toMatchObject({ role: 'editor' });
    await expect(
      permissions.requireWorkspaceRole('user', workspaceId, 'admin'),
    ).rejects.toMatchObject({
      response: { code: 'WORKSPACE_PERMISSION_DENIED' },
    });
    await sql.exec(
      "INSERT INTO crew_member_permission_overrides(member_id,permission_key,effect) VALUES ('member','studio.edit','deny')",
    );
    await expect(
      permissions.requireWorkspaceRole('user', workspaceId, 'editor'),
    ).rejects.toMatchObject({
      response: { code: 'WORKSPACE_PERMISSION_DENIED' },
    });
  });

  it.each([
    'removed',
    'suspended',
    'unlinked',
    'deleted',
    'workspace_archived',
    'workspace_deleted',
  ])('revokes inherited access when %s', async (change) => {
    await expect(
      permissions.requireWorkspacePresence('user', workspaceId),
    ).resolves.toMatchObject({ role: 'viewer' });
    if (change === 'removed' || change === 'suspended')
      await sql.query('UPDATE crew_members SET status=$1', [change]);
    else if (change === 'unlinked')
      await sql.exec('UPDATE crews SET studio_workspace_id=NULL');
    else if (change === 'deleted')
      await sql.exec('UPDATE crews SET deleted_at=now()');
    else if (change === 'workspace_archived')
      await sql.exec("UPDATE workspaces SET status='archived'");
    else await sql.exec('UPDATE workspaces SET deleted_at=now()');
    await expect(
      permissions.requireWorkspacePresence('user', workspaceId),
    ).rejects.toMatchObject({ response: { code: 'WORKSPACE_ACCESS_DENIED' } });
  });

  it('honors explicit edit access but denies inherited access when studio.view is denied', async () => {
    await sql.exec(
      "INSERT INTO crew_member_permission_overrides(member_id,permission_key,effect) VALUES ('member','studio.edit','allow')",
    );
    await expect(
      permissions.requireWorkspaceRole('user', workspaceId, 'editor'),
    ).resolves.toMatchObject({ role: 'editor' });
    await sql.exec(
      "INSERT INTO crew_member_permission_overrides(member_id,permission_key,effect) VALUES ('member','studio.view','deny')",
    );
    await expect(
      permissions.requireWorkspacePresence('user', workspaceId),
    ).rejects.toMatchObject({ response: { code: 'WORKSPACE_ACCESS_DENIED' } });
    await sql.query(
      "INSERT INTO workspace_members(id,workspace_id,user_id,role,status,access_scope) VALUES ('01990000-0000-7000-8000-000000000002',$1,'user','viewer','active','workspace')",
      [workspaceId],
    );
    await expect(
      permissions.requireWorkspacePresence('user', workspaceId),
    ).resolves.toMatchObject({ role: 'viewer' });
  });

  it('retains an independent billing grant after unlink without granting admin rights', async () => {
    await sql.query(
      "INSERT INTO workspace_members(id,workspace_id,user_id,role,status,access_scope) VALUES ('01990000-0000-7000-8000-000000000002',$1,'user','billing','active','workspace')",
      [workspaceId],
    );
    await sql.exec(
      "INSERT INTO crew_member_policies(member_id,policy_key) VALUES ('member','admin')",
    );
    await expect(
      permissions.requireWorkspaceRole('user', workspaceId, 'editor'),
    ).resolves.toMatchObject({ role: 'editor' });
    await expect(
      permissions.requireWorkspaceRole('user', workspaceId, 'billing'),
    ).resolves.toMatchObject({ role: 'billing' });
    await sql.exec('UPDATE crews SET studio_workspace_id=NULL');
    await expect(
      permissions.requireWorkspaceRole('user', workspaceId, 'billing'),
    ).resolves.toMatchObject({ role: 'billing' });
    await expect(
      permissions.requireWorkspaceRole('user', workspaceId, 'editor'),
    ).rejects.toMatchObject({
      response: { code: 'WORKSPACE_PERMISSION_DENIED' },
    });
  });
});
