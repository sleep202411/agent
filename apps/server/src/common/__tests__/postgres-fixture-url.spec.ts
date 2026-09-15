import { postgresFixtureUrl } from './postgres-fixture-url';

describe('PostgreSQL fixture connection options', () => {
  it.each(['postgres', 'postgresql'])(
    'retains named target fields for %s',
    (scheme) => {
      const parsed = postgresFixtureUrl(
        `${scheme}://fixture@localhost:55439/task01?sslmode=disable&application_name=test`,
      );
      expect([
        parsed.hostname,
        parsed.port,
        parsed.pathname,
        parsed.username,
      ]).toEqual(['localhost', '55439', '/task01', 'fixture']);
    },
  );
  it.each([
    'host=remote.invalid',
    'hostaddr=192.0.2.1',
    'port=5432',
    'database=production',
    'dbname=production',
    'user=other',
    'password=other',
    'options=-csearch_path=other',
    'service=other',
    'sslrootcert=file',
    'application_name=fixture&host=remote.invalid',
    '%68ost=remote.invalid',
  ])('rejects override %s', (query) => {
    expect(() =>
      postgresFixtureUrl(`postgresql://localhost:55439/task01?${query}`),
    ).toThrow();
  });
  it.each([
    'https://localhost:55439/task01',
    'postgresql://localhost:55439/task01#override',
    'not a URL',
  ])('rejects invalid fixture URL %s', (url) => {
    expect(() => postgresFixtureUrl(url)).toThrow();
  });
});
