import { backgroundTasksEnabled } from './background-tasks';

describe('background task configuration', () => {
  const original = process.env.BACKGROUND_TASKS_ENABLED;

  afterEach(() => {
    if (original === undefined) delete process.env.BACKGROUND_TASKS_ENABLED;
    else process.env.BACKGROUND_TASKS_ENABLED = original;
  });

  it('preserves existing deployments when omitted', () => {
    delete process.env.BACKGROUND_TASKS_ENABLED;
    expect(backgroundTasksEnabled()).toBe(true);
  });

  it.each(['true', ' false ', 'false'])(
    'accepts the explicit operational value %s',
    (value) => {
      process.env.BACKGROUND_TASKS_ENABLED = value;
      expect(backgroundTasksEnabled()).toBe(value.trim() === 'true');
    },
  );

  it.each(['', ' ', 'FALSE', '0', 'flase', 'yes'])(
    'rejects %s instead of accidentally enabling workers',
    (value) => {
      process.env.BACKGROUND_TASKS_ENABLED = value;
      expect(backgroundTasksEnabled).toThrow(
        'BACKGROUND_TASKS_ENABLED must be true or false',
      );
    },
  );
});
