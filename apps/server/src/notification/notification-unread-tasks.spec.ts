import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import type { PrismaService } from '../infra/db/db.module';
import type { AuthUser } from '../auth';

it('scopes unread task aggregation to the authenticated inbox with bound parameters', async () => {
  const rows = [{ taskId: 'task-1', count: 3 }];
  const query = jest
    .fn<Promise<typeof rows>, [{ text: string; values: unknown[] }]>()
    .mockResolvedValue(rows);
  const service = new NotificationService({
    $queryRaw: query,
  } as unknown as PrismaService);
  const controller = new NotificationController(service);
  await expect(
    controller.unreadCrewTasks({ userId: "user' OR TRUE" } as AuthUser),
  ).resolves.toEqual(rows);
  const sql = query.mock.calls[0][0] as { text: string; values: unknown[] };
  expect(sql.values).toEqual(["user' OR TRUE"]);
  expect(sql.text).toContain('user_id = $1 AND read_at IS NULL');
  expect(sql.text).toContain("type LIKE 'crew.task.%'");
  expect(sql.text).toContain("jsonb_typeof(meta->'taskId') = 'string'");
  expect(sql.text).toContain("GROUP BY meta->>'taskId'");
});

it('aggregates all Crew notification types for only the current user', async () => {
  const rows = [{ crewId: 'crew-1', count: 4 }];
  const query = jest
    .fn<Promise<typeof rows>, [{ text: string; values: unknown[] }]>()
    .mockResolvedValue(rows);
  const service = new NotificationService({
    $queryRaw: query,
  } as unknown as PrismaService);
  const controller = new NotificationController(service);
  await expect(
    controller.unreadCrews({ userId: 'user-2' } as AuthUser),
  ).resolves.toEqual(rows);
  const sql = query.mock.calls[0][0];
  expect(sql.values).toEqual(['user-2']);
  expect(sql.text).toContain('user_id = $1 AND read_at IS NULL');
  expect(sql.text).toContain("type LIKE 'crew.%'");
  expect(sql.text).toContain("jsonb_typeof(meta->'crewId') = 'string'");
  expect(sql.text).toContain("GROUP BY meta->>'crewId'");
});
