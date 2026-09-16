import { assertOutboxTestDatabase } from './outbox-test-database';

describe('outbox fixture admission', () => {
  it.each([
    'postgresql://127.0.0.1:55439/task01',
    'postgres://localhost:5433/fizzdragon_outbox_test',
    'postgresql://localhost:55439/task01?application_name=fixture&sslmode=disable',
  ])('accepts explicit fixture %s', (url) => {
    expect(() => assertOutboxTestDatabase(url)).not.toThrow();
  });
  it('preserves the conversation IPv6 opt-in only', () => {
    const url = 'postgresql://[::1]:55439/task01';
    expect(() => assertOutboxTestDatabase(url)).toThrow();
    expect(() => assertOutboxTestDatabase(url, true)).not.toThrow();
  });
  it.each([
    'https://localhost:55439/task01',
    'postgresql://remote.invalid:55439/task01',
    'postgresql://localhost:5432/task01',
    'postgresql://localhost:55439/production',
    'postgresql://localhost:55439/task01#fragment',
    ...[
      'host=remote.invalid',
      'hostaddr=192.0.2.1',
      'port=5432',
      'dbname=production',
      'options=-csearch_path=other',
      'service=production',
      'sslrootcert=file',
    ].map((query) => `postgresql://localhost:55439/task01?${query}`),
  ])('rejects unsafe target %s', (url) => {
    expect(() => assertOutboxTestDatabase(url)).toThrow();
  });
});
