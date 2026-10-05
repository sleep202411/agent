import {
  describe,
  it,
  before as beforeAll,
  after as afterAll,
  beforeEach,
} from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { StoryPermissionService } from '../src/story-studio/story-permission.service';
import type { StoryCapability } from '../src/story-studio/story-permission.service';

const WORKSPACE = '00000000-0000-4000-8000-000000000001';
const PROJECT = '00000000-0000-4000-8000-000000000002';

/** Executes the real authorization SQL without connecting to any configured DB. */
// node:test owns completion and reports failures for these registrations.
void describe('Story workspace authorization in PostgreSQL', () => {
  let db: PGlite;
  const service = new StoryPermissionService(null as never, null as never);
  beforeAll(async () => {
    db = await PGlite.create();
    await db.exec(`
      CREATE TABLE crews(id uuid PRIMARY KEY, studio_workspace_id uuid, deleted_at timestamptz);
      CREATE TABLE crew_members(id text PRIMARY KEY, crew_id uuid, user_id text, status text);
      CREATE TABLE workspaces(id uuid PRIMARY KEY, status text, deleted_at timestamptz);
      CREATE TABLE story_projects(id uuid PRIMARY KEY, workspace_id uuid, status text);
      CREATE TABLE workspace_members(id text PRIMARY KEY, workspace_id uuid, user_id text, role text, status text, removed_at timestamptz, access_scope text);
      CREATE TABLE story_project_members(id text PRIMARY KEY, story_project_id uuid, user_id text, role text, status text, removed_at timestamptz);
    `);
  });
  afterAll(async () => db.close());
  beforeEach(async () => {
    await db.exec(`TRUNCATE crews, crew_members, workspaces, story_projects, workspace_members, story_project_members;
      INSERT INTO workspaces VALUES ('${WORKSPACE}', 'active', NULL);
      INSERT INTO story_projects VALUES ('${PROJECT}', '${WORKSPACE}', 'active');
      INSERT INTO workspace_members VALUES ('member', '${WORKSPACE}', 'editor', 'editor', 'active', NULL, 'workspace');`);
  });
  async function authorize(userId: string, capability: StoryCapability) {
    return db.transaction(async (connection) => {
      const tx = {
        $queryRaw: async (
          parts: TemplateStringsArray,
          ...values: unknown[]
        ) => {
          const sql = parts.reduce(
            (text, part, index) => text + (index ? `$${index}` : '') + part,
            '',
          );
          return (await connection.query(sql, values)).rows;
        },
        // These cases isolate workspace/direct membership; Crew grants have
        // their own persistence suite. Still execute the current lock SQL above.
        crew: {
          findFirst: async () => {
            assert.equal(
              (await connection.query('SELECT id FROM crews')).rows.length,
              0,
            );
            return null;
          },
        },
        storyProject: {
          findUnique: async () =>
            (
              await connection.query(
                'SELECT id, workspace_id AS "workspaceId" FROM story_projects WHERE id=$1',
                [PROJECT],
              )
            ).rows[0] ?? null,
        },
      };
      return service.requireProjectInTransaction(
        tx as never,
        userId,
        PROJECT,
        capability,
      );
    });
  }
  void it('allows a workspace editor to generate without duplicating project memberships', async () => {
    assert.equal((await authorize('editor', 'story.generate')).role, 'editor');
    assert.equal(
      (await db.query('SELECT * FROM story_project_members')).rows.length,
      0,
    );
  });
  void it('does not grant workspace-wide access to the project-only directory entry', async () => {
    await db.exec("UPDATE workspace_members SET access_scope='project_only'");
    await assert.rejects(
      authorize('editor', 'story.read'),
      (error: unknown) =>
        (error as { response?: { code?: string } }).response?.code ===
        'STORY_PROJECT_NOT_FOUND',
    );
  });
  void it('preserves direct project access for an invited viewer without generation access', async () => {
    await db.exec(
      `INSERT INTO story_project_members VALUES ('guest-member', '${PROJECT}', 'guest', 'viewer', 'active', NULL)`,
    );
    assert.equal((await authorize('guest', 'story.read')).role, 'viewer');
    await assert.rejects(
      authorize('guest', 'story.generate'),
      (error: unknown) =>
        (error as { response?: { code?: string } }).response?.code ===
        'STORY_PERMISSION_DENIED',
    );
  });
  for (const status of ['removed', 'suspended'])
    void it(`denies ${status} workspace members`, async () => {
      await db.query('UPDATE workspace_members SET status=$1', [status]);
      await assert.rejects(
        authorize('editor', 'story.read'),
        (error: unknown) =>
          (error as { response?: { code?: string } }).response?.code ===
          'STORY_PROJECT_NOT_FOUND',
      );
    });
  void it('does not let billing-only membership spend shared credits', async () => {
    await db.exec("UPDATE workspace_members SET role='billing'");
    await assert.rejects(
      authorize('editor', 'story.generate'),
      (error: unknown) =>
        (error as { response?: { code?: string } }).response?.code ===
        'STORY_PERMISSION_DENIED',
    );
  });
  void it('denies access after the workspace is deleted', async () => {
    await db.exec('UPDATE workspaces SET deleted_at=now()');
    await assert.rejects(
      authorize('editor', 'story.read'),
      (error: unknown) =>
        (error as { response?: { code?: string } }).response?.code ===
        'STORY_PROJECT_NOT_FOUND',
    );
  });
});
