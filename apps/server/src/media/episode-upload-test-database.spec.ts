import { episodeUploadTestDatabase } from './episode-upload-test-database';
const fixture = 'postgresql://fixture@127.0.0.1:55439/task01';
describe('upload fixture admission', () => {
  it('uses the task selector before an unrelated inherited database', () => {
    expect(
      episodeUploadTestDatabase({
        TASK01_TEST_DATABASE_URL: fixture,
        DATABASE_URL: 'postgresql://example.invalid/prod',
      }),
    ).toBe(fixture);
  });
  it('retains the existing CI fixture and harmless connection labels', () => {
    const ci =
      'postgres://fixture@localhost:5433/fizzdragon_outbox_test?application_name=upload-test&sslmode=disable';
    expect(episodeUploadTestDatabase({ DATABASE_URL: ci })).toBe(ci);
  });
  it.each([
    '',
    'https://127.0.0.1:55439/task01',
    'postgresql://example.invalid:55439/task01',
    'postgresql://127.0.0.1:55439/production',
    'postgresql://127.0.0.1:5432/task01',
    fixture + '?host=example.invalid',
    fixture + '?options=-c%20search_path=production',
    fixture + '?dbname=production',
    fixture + '#fragment',
  ])(
    'rejects unexpected destinations and connection overrides: %s',
    (target) => {
      expect(() =>
        episodeUploadTestDatabase({
          TASK01_TEST_DATABASE_URL: target,
          DATABASE_URL: fixture,
        }),
      ).toThrow();
    },
  );
  it('rejects a missing selection', () => {
    expect(() => episodeUploadTestDatabase({})).toThrow(
      'Explicit named loopback',
    );
  });
});
