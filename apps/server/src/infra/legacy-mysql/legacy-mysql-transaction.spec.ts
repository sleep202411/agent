import { Logger } from '@nestjs/common';
import { LegacyPointsService } from '../../legacy-points/legacy-points.service';
import { LegacyMysqlService } from './legacy-mysql.service';

function fixture() {
  const conn = {
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
    query: jest.fn(),
  };
  const mysql = new LegacyMysqlService({} as never);
  Object.assign(mysql, {
    pool: { getConnection: jest.fn().mockResolvedValue(conn) },
  });
  return { conn, mysql, points: new LegacyPointsService(mysql) };
}

describe('Legacy MySQL transaction errors', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    {
      rows: [],
      score: 1,
      status: 404,
      message: 'No legacy user matches that phone/email',
    },
    {
      rows: [{ id: '123', score_balance: 2 }],
      score: -3,
      status: 400,
      message: 'Deduction would drive balance below zero',
    },
  ])(
    'preserves points validation status $status without writes',
    async ({ rows, score, status, message }) => {
      const { conn, points } = fixture();
      conn.query.mockResolvedValueOnce([rows]);
      await expect(
        points.grantPoints({
          identifier: 'fixture',
          score,
          operatorId: 'admin',
        }),
      ).rejects.toMatchObject({ status, response: { message } });
      expect(conn.rollback).toHaveBeenCalledTimes(1);
      expect(conn.release).toHaveBeenCalledTimes(1);
      expect(conn.commit).not.toHaveBeenCalled();
      expect(conn.query).toHaveBeenCalledTimes(1);
    },
  );

  it('normalizes driver errors and releases even if rollback fails', async () => {
    const { conn, mysql } = fixture();
    conn.rollback.mockRejectedValueOnce(new Error('rollback unavailable'));
    await expect(
      mysql.transaction(() =>
        Promise.reject(new Error('private driver detail')),
      ),
    ).rejects.toMatchObject({
      status: 503,
      response: {
        message: 'Legacy database unavailable',
        upstream: 'legacy-mysql',
      },
    });
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.release).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it('commits successful work and releases', async () => {
    const { conn, mysql } = fixture();
    await expect(
      mysql.transaction(() => Promise.resolve('done')),
    ).resolves.toBe('done');
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
  });
});
