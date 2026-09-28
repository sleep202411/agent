import { publisherTestClient as client } from './ip-publishers.test-adapter';
import { IpPublishersService } from './ip-publishers.service';

const { PGlite } = process.getBuiltinModule('module').createRequire(__filename)(
  '@electric-sql/pglite',
) as typeof import('@electric-sql/pglite');

const ipId = '00000000-0000-4000-8000-000000000001';
const first = '00000000-0000-4000-8000-000000000002';
const second = '00000000-0000-4000-8000-000000000003';
const missing = '00000000-0000-4000-8000-000000000004';
describe('IP publisher replacement persistence', () => {
  let db: import('@electric-sql/pglite').PGlite;
  let service: IpPublishersService;
  beforeAll(async () => {
    db = await PGlite.create();
    await db.exec(`
      CREATE TABLE ips (id uuid PRIMARY KEY, deleted_at timestamp);
      CREATE TABLE ip_publishers (id uuid PRIMARY KEY, status text NOT NULL);
      CREATE TABLE assignments (
        ip_id uuid REFERENCES ips(id), publisher_id uuid REFERENCES ip_publishers(id),
        display_order integer, created_by_id varchar(64),
        UNIQUE(ip_id, publisher_id)
      );
    `);
    service = new IpPublishersService({
      // Deliberately expose no non-transactional delegates: validation and
      // response reads must remain inside the same transaction as the write.
      $transaction: (
        work: (tx: ReturnType<typeof client>) => Promise<unknown>,
      ) => db.transaction((tx) => work(client(tx))),
    } as never);
  }, 30000);
  beforeEach(async () => {
    await db.exec('TRUNCATE assignments, ip_publishers, ips');
    await db.query('INSERT INTO ips VALUES ($1, NULL)', [ipId]);
    await db.query(
      "INSERT INTO ip_publishers VALUES ($1, 'active'), ($2, 'active')",
      [first, second],
    );
    await save([first]);
  });
  afterAll(async () => {
    await db.close();
  });

  const save = (publisherIds: string[], userId = ipId) =>
    service.setForIp({ userId } as never, ipId, { publisherIds });
  const ids = async () =>
    (await client(db).ipPublisherAssignment.findMany({ where: { ipId } })).map(
      (row) => row.publisher.id,
    );

  it('replaces the list in requested order and records the administrator', async () => {
    const result = await save([second, first]);
    expect(result.publishers.map((row) => row.id)).toEqual([second, first]);
    expect(await ids()).toEqual([second, first]);
    expect(
      (await db.query('SELECT DISTINCT created_by_id FROM assignments')).rows,
    ).toEqual([{ created_by_id: ipId }]);
  });

  it('clears the list', async () => {
    expect(await save([])).toEqual({ publishers: [] });
    expect(await ids()).toEqual([]);
  });

  it.each([
    ['duplicate', [first, first], 'Duplicate publisher'],
    ['missing', [missing], 'publishers were not found'],
  ])(
    'rejects %s publishers without deleting existing assignments',
    async (_label, publishers, error) => {
      await expect(save(publishers)).rejects.toThrow(error);
      expect(await ids()).toEqual([first]);
    },
  );

  it('rejects inactive publishers without deleting existing assignments', async () => {
    await db.query(
      "UPDATE ip_publishers SET status = 'inactive' WHERE id = $1",
      [second],
    );
    await expect(save([second])).rejects.toThrow('Only active publishers');
    expect(await ids()).toEqual([first]);
  });

  it('rejects a deleted IP', async () => {
    await db.query('UPDATE ips SET deleted_at = NOW() WHERE id = $1', [ipId]);
    await expect(save([])).rejects.toThrow('IP not found');
    expect(await ids()).toEqual([first]);
  });

  it('rolls back deletion if inserting the replacement fails', async () => {
    await expect(save([second], 'x'.repeat(65))).rejects.toThrow();
    expect(await ids()).toEqual([first]);
  });

  it('returns each replacement snapshot, including concurrent clear and replace calls', async () => {
    // PGlite serializes transactions. This verifies real SQL and transaction
    // boundaries, not multi-connection PostgreSQL lock contention.
    const results = await Promise.all([
      save([second]),
      save([]),
      save([first, second]),
    ]);
    expect(
      results.map((result) => result.publishers.map((row) => row.id)),
    ).toEqual([[second], [], [first, second]]);
    expect(await ids()).toEqual([first, second]);
  });
});
