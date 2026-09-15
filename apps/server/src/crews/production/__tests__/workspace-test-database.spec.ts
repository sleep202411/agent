import { workspaceTestDatabase } from './workspace-test-database';
const local = 'postgresql://fixture@127.0.0.1:55480/crew_workspace_loop_test';
const ci = 'postgres://fixture@localhost:55439/task01?sslmode=disable';
it('retains local opt-in and accepts the existing CI selectors', () => {
  expect(workspaceTestDatabase({})).toBeUndefined();
  expect(workspaceTestDatabase({ DATABASE_URL: ci })).toBeUndefined();
  expect(
    workspaceTestDatabase({
      CREW_WORKSPACE_TEST_DATABASE_URL: local,
      TASK01_TEST_DATABASE_URL: ci,
    }),
  ).toBe(local);
  expect(workspaceTestDatabase({ TASK01_TEST_DATABASE_URL: ci })).toBe(ci);
  expect(
    workspaceTestDatabase({
      DATABASE_POSTGRES_INTEGRATION: '1',
      DATABASE_URL: ci,
    }),
  ).toBe(ci);
});
it.each([
  local.replace('postgresql:', 'https:'),
  local.replace('127.0.0.1', 'db.example.invalid'),
  local.replace('55480', '5432'),
  local.replace('crew_workspace_loop_test', 'production'),
  `${local}?host=remote.example.invalid`,
  `${local}?host=/var/run/postgresql`,
  `${local}?port=5432`,
  `${local}?options=-c%20search_path=public`,
  `${local}#fragment`,
])('rejects unsafe connection overrides: %s', (url) => {
  expect(() =>
    workspaceTestDatabase({
      CREW_WORKSPACE_TEST_DATABASE_URL: url,
      TASK01_TEST_DATABASE_URL: ci,
    }),
  ).toThrow();
});
