import { LegacyPointsService } from './legacy-points.service';

function serviceWithRows(rows: Array<{ email: string | null }>) {
  const query = jest.fn().mockResolvedValue(rows);
  return {
    service: new LegacyPointsService({ query } as never),
    query,
  };
}

describe('LegacyPointsService.exportActiveEmails', () => {
  it('exports unique trimmed emails for 正常 accounts only', async () => {
    const { service, query } = serviceWithRows([
      { email: '  a@fizzdragon.com ' },
      { email: 'A@fizzdragon.com' },
      { email: 'b@fizzdragon.com' },
      { email: '   ' },
      { email: null },
    ]);

    const result = await service.exportActiveEmails();

    expect(String(query.mock.calls[0]?.[0])).toContain('account_status = 0');
    expect(result.emails).toEqual(['a@fizzdragon.com', 'b@fizzdragon.com']);
    expect(result.count).toBe(2);
    expect(result.workbook).toContain('a@fizzdragon.com');
    expect(result.workbook).toContain('b@fizzdragon.com');
    expect(result.workbook).toContain('Excel.Sheet');
    expect(result.filename).toMatch(
      /^active-user-emails-\d{4}-\d{2}-\d{2}\.xls$/,
    );
  });
});
