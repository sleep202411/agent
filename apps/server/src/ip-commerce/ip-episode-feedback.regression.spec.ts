import 'reflect-metadata';
import { PGlite } from '@electric-sql/pglite';
import { IpEpisodeFeedbackService } from './ip-episode-feedback';
import { readIpProductionEvidence } from './ip-production-evidence';

jest.mock('../infra/db/db.module', () => ({ PrismaService: class {} }));
jest.mock('./ip-commerce.service', () => ({ IpCommerceService: class {} }));
jest.mock('../auth', () => ({
  Public: () => () => {},
  CurrentUser: () => () => {},
}));
jest.mock('../admin-auth', () => ({
  ADMIN_PERMISSION_KEYS: { IpRead: 'ip.read' },
  AdminAuthGuard: class {},
  AdminPermissionGuard: class {},
  RequireAdminPermissions: () => () => {},
}));

const ipId = '00000000-0000-4000-8000-000000000001';
const episodeId = '00000000-0000-4000-8000-000000000002';
const viewer = { userId: 'viewer', nickName: 'Viewer' };

// PGlite uses dynamic imports under Jest: run with --experimental-vm-modules.
const integration =
  process.env.IP_FEEDBACK_SQL_TEST === '1' ? describe : describe.skip;
integration('published episode feedback regression', () => {
  let pg: PGlite;
  let service: IpEpisodeFeedbackService;
  const findFirst = jest.fn();
  const ensurePublicEngagementTarget = jest.fn();
  let db: Parameters<typeof readIpProductionEvidence>[0];
  beforeAll(async () => {
    pg = new PGlite();
    await pg.exec(`
      CREATE TABLE ips(id uuid PRIMARY KEY,status text,deleted_at timestamptz);
      CREATE TABLE ip_episodes(id uuid PRIMARY KEY,ip_id uuid,episode_no integer,status text,deleted_at timestamptz);
      CREATE TABLE ip_likes(ip_id uuid,actor_kind text,status text,removed_at timestamptz);
      CREATE TABLE ip_episode_feedback(episode_id uuid,user_id text,value integer,updated_at timestamptz DEFAULT now(),PRIMARY KEY(episode_id,user_id));
      INSERT INTO ips VALUES ('${ipId}','published',NULL);
      INSERT INTO ip_episodes VALUES ('${episodeId}','${ipId}',2,'published',NULL);
    `);
    const query = async (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      const sql = strings.reduce(
        (text, part, index) => text + (index ? `$${index}` : '') + part,
        '',
      );
      return (await pg.query(sql, values)).rows;
    };
    const adapter = {
      ipEpisode: { findFirst },
      $queryRaw: query,
      $executeRaw: query,
      $transaction: (work: (tx: typeof db) => Promise<unknown>) => work(db),
    };
    db = adapter as unknown as typeof db;
    service = new IpEpisodeFeedbackService(
      adapter as never,
      {
        ensurePublicEngagementTarget,
      } as never,
    );
  });
  beforeEach(async () => {
    jest.resetAllMocks();
    findFirst.mockResolvedValue({ id: episodeId });
    await pg.exec('DELETE FROM ip_episode_feedback');
  });
  afterAll(async () => {
    await pg.close();
  });

  it('accepts a published episode without any localization and records like, dislike and clear', async () => {
    await expect(service.read(ipId, episodeId)).resolves.toEqual({
      likes: 0,
      dislikes: 0,
      mine: null,
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: episodeId,
        ipId,
        deletedAt: null,
        status: 'published',
        episodeNo: { gte: 1, lte: 3 },
      },
      select: { id: true },
    });
    await expect(service.vote(ipId, episodeId, viewer, 1)).resolves.toEqual({
      likes: 1,
      dislikes: 0,
      mine: 1,
    });
    await expect(service.vote(ipId, episodeId, viewer, 1)).resolves.toEqual({
      likes: 1,
      dislikes: 0,
      mine: 1,
    });
    await expect(service.vote(ipId, episodeId, viewer, -1)).resolves.toEqual({
      likes: 0,
      dislikes: 1,
      mine: -1,
    });
    expect((await readIpProductionEvidence(db, ipId)).episodes).toEqual([
      { episodeId, episodeNo: 2, likes: '0', dislikes: '1' },
    ]);
    await expect(service.vote(ipId, episodeId, viewer, null)).resolves.toEqual({
      likes: 0,
      dislikes: 0,
      mine: null,
    });
  });
  it('rejects an ineligible episode without recording a vote', async () => {
    findFirst.mockResolvedValue(null);
    await expect(service.vote(ipId, episodeId, viewer, 1)).rejects.toThrow(
      'Published episode not found.',
    );
    expect((await pg.query('SELECT * FROM ip_episode_feedback')).rows).toEqual(
      [],
    );
  });
  it('keeps the IP access check authoritative for reads and writes', async () => {
    ensurePublicEngagementTarget.mockRejectedValue(new Error('Not public'));
    await expect(service.read(ipId, episodeId)).rejects.toThrow('Not public');
    await expect(service.vote(ipId, episodeId, viewer, 1)).rejects.toThrow(
      'Not public',
    );
    expect(findFirst).not.toHaveBeenCalled();
    expect((await pg.query('SELECT * FROM ip_episode_feedback')).rows).toEqual(
      [],
    );
  });
  it('excludes unpublished, deleted and later episodes from evidence', async () => {
    await pg.exec(`INSERT INTO ip_episodes VALUES
      ('00000000-0000-4000-8000-000000000003','${ipId}',1,'draft',NULL),
      ('00000000-0000-4000-8000-000000000004','${ipId}',3,'published',now()),
      ('00000000-0000-4000-8000-000000000005','${ipId}',4,'published',NULL)`);
    expect(
      (await readIpProductionEvidence(db, ipId)).episodes.map(
        (row) => row.episodeId,
      ),
    ).toEqual([episodeId]);
  });
});
