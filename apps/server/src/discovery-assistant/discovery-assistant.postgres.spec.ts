import { z } from 'zod';
import { DiscoveryWorkerRequestSchema } from '@repo/shared/discovery-assistant';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModuleRef } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import { buildPrisma, type PrismaService } from '../infra/db/db.module';
import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import type { ContentGpsSearchService } from '../ip-commerce/content-gps-search';
import type { IpCommerceService } from '../ip-commerce/ip-commerce.service';
import type { CreatorDiscoveryService } from '../creator-services/creator-discovery';
import { DiscoveryAssistantService } from './discovery-assistant.service';

const databaseUrl = process.env.CONTENT_GPS_TEST_DATABASE_URL;
const query = {
  basedIn: null,
  serves: null,
  remoteOnly: false,
  availableForWork: false,
  category: null,
  text: '',
};
const user = { userId: 'viewer-1' };
const answer = {
  status: 'clarification',
  question: 'Based in Singapore or serving Singapore?',
};
const request = () => ({
  requestId: randomUUID(),
  locale: 'en-US',
  conversation: {
    current: { kind: 'creators', query },
    messages: [{ role: 'user', content: 'Find a Singapore studio' }],
  },
});
(databaseUrl ? describe : describe.skip)(
  'discovery admission and recovery (isolated PostgreSQL)',
  () => {
    let db: PrismaClient;
    let service: DiscoveryAssistantService;
    const worker = { discoverContentGps: jest.fn() };
    const creators = { search: jest.fn() };
    const ips = { search: jest.fn() };
    const catalogue = { listTaxonomyTerms: jest.fn() };
    const keys = [
      'CONTENT_GPS_DISCOVERY_ENABLED',
      'CONTENT_GPS_DISCOVERY_REGION',
      'CONTENT_GPS_DISCOVERY_DAILY_LIMIT',
      'CONTENT_GPS_DISCOVERY_MAX_IN_FLIGHT',
    ];
    const env = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    beforeAll(async () => {
      const url = postgresFixtureUrl(databaseUrl!);
      if (
        !['localhost', '127.0.0.1'].includes(url.hostname) ||
        url.port !== '55441' ||
        url.pathname !== '/gps_test'
      )
        throw new Error('Dedicated GPS fixture required');
      db = buildPrisma(databaseUrl);
      const sql = readFileSync(
        join(
          __dirname,
          '../../prisma/migrations/20261001223000_discovery_assistant_requests/migration.sql',
        ),
        'utf8',
      );
      for (const statement of sql.split(';').filter((s) => s.trim()))
        await db.$executeRawUnsafe(statement);
      service = new DiscoveryAssistantService(
        db as PrismaService,
        { get: () => worker } as unknown as ModuleRef,
        ips as unknown as ContentGpsSearchService,
        creators as unknown as CreatorDiscoveryService,
        catalogue as unknown as IpCommerceService,
      );
    });
    afterAll(async () => {
      if (db) {
        await db.$executeRawUnsafe(
          'DROP TABLE IF EXISTS discovery_assistant_requests',
        );
        await db.$disconnect();
      }
      for (const key of keys) {
        if (env[key] === undefined) delete process.env[key];
        else process.env[key] = env[key];
      }
    });
    beforeEach(async () => {
      await db.$executeRawUnsafe('TRUNCATE discovery_assistant_requests');
      jest.clearAllMocks();
      worker.discoverContentGps.mockReset().mockResolvedValue(answer);
      creators.search.mockReset();
      ips.search.mockReset();
      catalogue.listTaxonomyTerms.mockResolvedValue({ items: [] });
      process.env.CONTENT_GPS_DISCOVERY_ENABLED = 'true';
      process.env.CONTENT_GPS_DISCOVERY_REGION = 'global';
      process.env.CONTENT_GPS_DISCOVERY_DAILY_LIMIT = '10';
      process.env.CONTENT_GPS_DISCOVERY_MAX_IN_FLIGHT = '3';
    });
    const signal = () => new AbortController().signal;
    it('persists admission before dispatch and replays without another Worker call even when disabled', async () => {
      const body = request();
      worker.discoverContentGps.mockImplementation(async () => {
        const rows = await db.$queryRaw<
          { status: string }[]
        >`SELECT status FROM discovery_assistant_requests`;
        expect(rows).toEqual([{ status: 'dispatched' }]);
        return answer;
      });
      await expect(service.run(user, body, signal())).resolves.toMatchObject({
        status: 'succeeded',
        result: answer,
      });
      process.env.CONTENT_GPS_DISCOVERY_ENABLED = 'false';
      await expect(service.run(user, body, signal())).resolves.toMatchObject({
        status: 'succeeded',
        result: answer,
      });
      expect(worker.discoverContentGps).toHaveBeenCalledTimes(1);
      await expect(
        service.receipt({ userId: 'other' }, body.requestId),
      ).rejects.toThrow('not found');
    });
    it('rejects changed input with the same request identity', async () => {
      const body = request();
      await service.run(user, body, signal());
      await expect(
        service.run(user, { ...body, locale: 'zh-CN' }, signal()),
      ).rejects.toThrow('different input');
      expect(worker.discoverContentGps).toHaveBeenCalledTimes(1);
    });
    it('does not redispatch uncertain outcomes', async () => {
      const body = request();
      worker.discoverContentGps.mockRejectedValue(new Error('lost reply'));
      await expect(service.run(user, body, signal())).rejects.toThrow(
        'lost reply',
      );
      await expect(service.run(user, body, signal())).resolves.toMatchObject({
        status: 'uncertain',
        result: null,
      });
      expect(worker.discoverContentGps).toHaveBeenCalledTimes(1);
    });
    it('allows only live scoped reads and clears the credential at completion', async () => {
      const body = request();
      let read: unknown;
      creators.search.mockResolvedValue({ test: 'live result' });
      worker.discoverContentGps.mockImplementation(
        async (input: z.infer<typeof DiscoveryWorkerRequestSchema>) => {
          read = {
            ...input.credential,
            kind: 'creators',
            input: {
              requestId: randomUUID(),
              query,
              limit: 10,
              cursor: null,
              selectedCreatorId: null,
              map: null,
            },
          };
          await expect(service.read(read)).resolves.toEqual({
            test: 'live result',
          });
          expect(creators.search).toHaveBeenCalledWith(expect.anything(), user);
          return answer;
        },
      );
      await service.run(user, body, signal());
      await expect(service.read(read)).rejects.toThrow(
        'invalid, expired or exhausted',
      );
      const [row] = await db.$queryRaw<
        { read_token_hash: string | null; read_count: number }[]
      >`SELECT read_token_hash, read_count FROM discovery_assistant_requests`;
      expect(row).toEqual({ read_token_hash: null, read_count: 1 });
    });
    it('rejects forged credentials and mode switching before catalogue access', async () => {
      worker.discoverContentGps.mockImplementation(
        async (input: z.infer<typeof DiscoveryWorkerRequestSchema>) => {
          const read = {
            ...input.credential,
            kind: 'creators',
            input: {
              requestId: randomUUID(),
              query,
              limit: 10,
              cursor: null,
              selectedCreatorId: null,
              map: null,
            },
          };
          await expect(
            service.read({ ...read, readToken: 'f'.repeat(64) }),
          ).rejects.toThrow('invalid, expired or exhausted');
          await expect(
            service.read({ ...read, input: { ...read.input, limit: 11 } }),
          ).rejects.toThrow('scope mismatch');
          expect(creators.search).not.toHaveBeenCalled();
          return answer;
        },
      );
      await service.run(user, request(), signal());
    });
    it('cancellation during a read prevents its result escaping and blocks a late Worker completion', async () => {
      const body = request();
      creators.search.mockImplementation(async () => {
        await service.cancel(user, body.requestId);
        return { test: 'revoked' };
      });
      worker.discoverContentGps.mockImplementation(
        async (input: z.infer<typeof DiscoveryWorkerRequestSchema>) => {
          await expect(
            service.read({
              ...input.credential,
              kind: 'creators',
              input: {
                requestId: randomUUID(),
                query,
                limit: 10,
                cursor: null,
                selectedCreatorId: null,
                map: null,
              },
            }),
          ).rejects.toThrow('cancelled or expired');
          return answer;
        },
      );
      await expect(service.run(user, body, signal())).rejects.toThrow(
        'expired or was cancelled',
      );
      await expect(
        service.receipt(user, body.requestId),
      ).resolves.toMatchObject({ status: 'cancelled', result: null });
    });
    it('serializes concurrent admission for the same request', async () => {
      const body = request();
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      let started!: () => void;
      const ready = new Promise<void>((resolve) => {
        started = resolve;
      });
      worker.discoverContentGps.mockImplementation(async () => {
        started();
        await pending;
        return answer;
      });
      const first = service.run(user, body, signal());
      await ready;
      await expect(service.run(user, body, signal())).resolves.toMatchObject({
        status: 'dispatched',
        result: null,
      });
      await expect(service.run(user, request(), signal())).rejects.toThrow(
        'active request limit',
      );
      release();
      await first;
      expect(worker.discoverContentGps).toHaveBeenCalledTimes(1);
    });
    it('enforces the configured global daily quota before dispatch', async () => {
      process.env.CONTENT_GPS_DISCOVERY_DAILY_LIMIT = '1';
      await service.run(user, request(), signal());
      await expect(
        service.run({ userId: 'another' }, request(), signal()),
      ).rejects.toThrow('quota');
      expect(worker.discoverContentGps).toHaveBeenCalledTimes(1);
    });
    it('marks expired work uncertain and rejects completion', async () => {
      const body = request();
      worker.discoverContentGps.mockImplementation(async () => {
        await db.$executeRaw`UPDATE discovery_assistant_requests SET read_expires_at = now() - interval '1 second'`;
        await expect(
          service.receipt(user, body.requestId),
        ).resolves.toMatchObject({ status: 'uncertain' });
        return answer;
      });
      await expect(service.run(user, body, signal())).rejects.toThrow(
        'expired or was cancelled',
      );
    });
    it('fails closed without explicit enablement/configuration', async () => {
      process.env.CONTENT_GPS_DISCOVERY_ENABLED = 'false';
      await expect(service.run(user, request(), signal())).rejects.toThrow(
        'not enabled',
      );
      process.env.CONTENT_GPS_DISCOVERY_ENABLED = 'true';
      delete process.env.CONTENT_GPS_DISCOVERY_REGION;
      await expect(service.run(user, request(), signal())).rejects.toThrow(
        'must be configured',
      );
      expect(worker.discoverContentGps).not.toHaveBeenCalled();
    });
    it('rechecks saved recommendations on receipt and never restores withdrawn cards', async () => {
      const body = request();
      const card = {
        id: 'studio',
        name: 'Original',
        avatarUrl: '',
        openToWork: true,
        matched: true,
        basedIn: null,
        serves: [],
        remote: true,
        showOnMap: false,
        point: null,
        serviceCount: 1,
        matchingServiceCount: 1,
      };
      const queryId = 'a'.repeat(64);
      worker.discoverContentGps.mockResolvedValue({
        status: 'results',
        kind: 'creators',
        query,
        queryId,
        cards: [card],
        matchedCount: 1,
        accessibleCount: 2,
        countScope: 'public_platform_creators_with_listed_services',
        requiresLogin: false,
      });
      creators.search.mockImplementation((r: { requestId: string }) =>
        Promise.resolve({
          requestId: r.requestId,
          queryId,
          query,
          items: [card],
          selected: { ...card, name: 'Current' },
          nextCursor: null,
          matchedCount: 1,
          accessibleCount: 2,
          countScope: 'public_platform_creators_with_listed_services',
          requiresLogin: false,
          island: { creatorCount: 0, matchedCreatorCount: 0 },
          map: null,
        }),
      );
      await expect(service.run(user, body, signal())).resolves.toMatchObject({
        result: { cards: [{ name: 'Current' }] },
      });
      creators.search.mockImplementation((r: { requestId: string }) =>
        Promise.resolve({
          requestId: r.requestId,
          queryId,
          query,
          items: [],
          selected: null,
          nextCursor: null,
          matchedCount: 0,
          accessibleCount: 1,
          countScope: 'public_platform_creators_with_listed_services',
          requiresLogin: false,
          island: { creatorCount: 0, matchedCreatorCount: 0 },
          map: null,
        }),
      );
      await expect(service.receipt(user, body.requestId)).rejects.toThrow(
        'results changed',
      );
      await expect(service.run(user, body, signal())).rejects.toThrow(
        'results changed',
      );
      expect(worker.discoverContentGps).toHaveBeenCalledTimes(1);
    });
    it('bounds scoped reads independently of the Worker search loop', async () => {
      creators.search.mockResolvedValue({ valid: true });
      worker.discoverContentGps.mockImplementation(
        async (input: z.infer<typeof DiscoveryWorkerRequestSchema>) => {
          const read = {
            ...input.credential,
            kind: 'creators',
            input: {
              requestId: randomUUID(),
              query,
              limit: 1,
              cursor: null,
              selectedCreatorId: null,
              map: null,
            },
          };
          for (let i = 0; i < 16; i++) await service.read(read);
          await expect(service.read(read)).rejects.toThrow('exhausted');
          return answer;
        },
      );
      await service.run(user, request(), signal());
      expect(creators.search).toHaveBeenCalledTimes(16);
    });
  },
);
