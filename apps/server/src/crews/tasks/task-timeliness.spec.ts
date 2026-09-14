import { approvedSubmissionTimeliness } from './task-timeliness';
describe('approved submission timeliness', () => {
  const evidence = { version: 1, deadline: '2026-09-13T10:00:00.000Z' };
  it('uses submission time and includes the deadline boundary', () => {
    expect(
      approvedSubmissionTimeliness(new Date('2026-09-13T10:00:00Z'), evidence)
        ?.points,
    ).toBe(200);
    expect(
      approvedSubmissionTimeliness(
        new Date('2026-09-13T10:00:00.001Z'),
        evidence,
      )?.points,
    ).toBe(-200);
  });
  it('does not guess historical or missing deadlines', () => {
    for (const value of [
      null,
      {},
      { version: 1, deadline: null },
      { version: 1, deadline: 'invalid' },
      { version: 2, deadline: evidence.deadline },
    ])
      expect(approvedSubmissionTimeliness(new Date(), value)).toBeNull();
  });
});
