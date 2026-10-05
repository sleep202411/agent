import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { AuthGuard, AuthService } from '../auth';
import {
  AdminAuthGuard,
  AdminAuthService,
  AdminPermissionGuard,
  ADMIN_PERMISSION_KEYS,
} from '../admin-auth';
import { RevenueAdminController } from './revenue-admin.controller';
import { RevenueContractsService } from './revenue-contracts.service';
import { RevenueDistributionService } from './revenue-distribution.service';
import { RevenueAdminReadService } from './revenue-admin-read.service';
import {
  CreatorWithdrawalsController,
  CreatorWithdrawalsAdminController,
} from './creator-withdrawals.controller';
import { CreatorWithdrawalsService } from './creator-withdrawals.service';
import {
  WithdrawalAdminService,
  WITHDRAWAL_MANAGE_PERMISSION,
} from './withdrawal-admin.service';

describe('Withdrawal HTTP access and request contract', () => {
  let app: INestApplication;
  let server: Server;
  const balances = jest
    .fn<Promise<unknown[]>, [string]>()
    .mockResolvedValue([]);
  const queue = jest.fn().mockResolvedValue({ items: [] });
  const upload = jest.fn().mockResolvedValue({ id: 'verified-contract' });
  const postRevenue = jest.fn().mockResolvedValue({ id: 'revenue-receipt' });
  const reverseRevenue = jest
    .fn()
    .mockResolvedValue({ id: 'receipt', status: 'reversed' });
  const members = jest.fn().mockResolvedValue({ items: [], nextCursor: null });
  const receipt = jest
    .fn()
    .mockResolvedValue({ id: 'receipt', participants: [] });
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [
        CreatorWithdrawalsController,
        CreatorWithdrawalsAdminController,
        RevenueAdminController,
      ],
      providers: [
        { provide: APP_GUARD, useClass: AuthGuard },
        {
          provide: AuthService,
          useValue: {
            validateSessionContext: (cookie: string) =>
              Promise.resolve(
                cookie === 'satoken=creator'
                  ? { user: { userId: 'verified-creator' }, cookie }
                  : null,
              ),
          },
        },
        AdminAuthGuard,
        AdminPermissionGuard,
        {
          provide: AdminAuthService,
          useValue: {
            validateSession: (token: string) => {
              if (!['finance', 'ordinary', 'withdrawal-only'].includes(token))
                throw new UnauthorizedException();
              return Promise.resolve({
                id: 'admin',
                permissions:
                  token === 'finance'
                    ? [
                        WITHDRAWAL_MANAGE_PERMISSION,
                        ADMIN_PERMISSION_KEYS.CreatorRevenueManage,
                      ]
                    : token === 'withdrawal-only'
                      ? [WITHDRAWAL_MANAGE_PERMISSION]
                      : [],
              });
            },
          },
        },
        {
          provide: CreatorWithdrawalsService,
          useValue: { balances, request: jest.fn() },
        },
        { provide: WithdrawalAdminService, useValue: { queue } },
        { provide: RevenueContractsService, useValue: { upload } },
        {
          provide: RevenueAdminReadService,
          useValue: { members, distribution: receipt },
        },
        {
          provide: RevenueDistributionService,
          useValue: { post: postRevenue, reverse: reverseRevenue },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Server;
  });
  afterAll(async () => {
    await app?.close();
  });
  it('rejects anonymous and expired creator sessions', async () => {
    await request(server).get('/me/withdrawals/balances').expect(401);
    await request(server)
      .get('/me/withdrawals/balances')
      .set('Cookie', 'satoken=expired')
      .expect(401);
  });
  it('takes creator identity from the verified session and forbids caching', async () => {
    await request(server)
      .get('/me/withdrawals/balances')
      .set('Cookie', 'satoken=creator')
      .expect('Cache-Control', 'no-store')
      .expect(200);
    expect(balances).toHaveBeenCalledWith('verified-creator');
  });
  it('rejects injected beneficiary and client-calculated amount', async () => {
    await request(server)
      .post('/me/withdrawals')
      .set('Cookie', 'satoken=creator')
      .send({
        requestId: '11111111-1111-4111-8111-111111111111',
        currency: 'USD',
        percentageBps: 5000,
        expectedAvailableAmountMinor: '3000',
        recipient: {
          fullName: 'Fixture',
          accountNumber: 'fixture1234',
          address: 'Address',
          swift: 'DBSSSGSG',
          branchAddress: 'Branch',
        },
        userId: 'another-creator',
        amountMinor: '99999',
      })
      .expect(400);
  });
  it('requires a separate admin session and withdrawal permission', async () => {
    await request(server)
      .get('/admin/creator-withdrawals')
      .set('Cookie', 'satoken=creator')
      .expect(401);
    await request(server)
      .get('/admin/creator-withdrawals')
      .set('Authorization', 'Bearer ordinary')
      .expect(403);
    await request(server)
      .get('/admin/creator-withdrawals')
      .set('Authorization', 'Bearer finance')
      .expect('Cache-Control', 'no-store')
      .expect(200);
    expect(queue).toHaveBeenCalledTimes(1);
  });
  it('validates admin identifiers and transition inputs before invoking payment logic', async () => {
    await request(server)
      .post('/admin/creator-withdrawals/not-a-uuid/decision')
      .set('Authorization', 'Bearer finance')
      .send({ action: 'pay', expectedVersion: 2, paymentReference: '' })
      .expect(400);
  });
  it('requires revenue permission independently from withdrawal permission', async () => {
    await request(server)
      .post('/admin/creator-revenue/preview')
      .send({})
      .expect(401);
    await request(server)
      .post('/admin/creator-revenue/preview')
      .set('Authorization', 'Bearer withdrawal-only')
      .send({})
      .expect(403);
  });
  it('previews exact amounts without posting any earnings', async () => {
    const result = await request(server)
      .post('/admin/creator-revenue/preview')
      .set('Authorization', 'Bearer finance')
      .send({
        currency: 'USD',
        amountMinor: '301',
        participants: [{ crewMemberId: 'one', shareBps: 10000 }],
      })
      .expect('Cache-Control', 'private, no-store')
      .expect(200);
    expect(result.body).toEqual({
      code: 200,
      data: {
        currency: 'USD',
        amountMinor: '301',
        participants: [
          { crewMemberId: 'one', shareBps: 10000, amountMinor: '301' },
        ],
      },
    });
    expect(postRevenue).not.toHaveBeenCalled();
  });
  it('protects beneficiary lookup and rejects unbounded query parameters', async () => {
    await request(server)
      .get('/admin/creator-revenue/crews/crew/members')
      .set('Authorization', 'Bearer withdrawal-only')
      .expect(403);
    await request(server)
      .get('/admin/creator-revenue/crews/crew/members?limit=999999')
      .set('Authorization', 'Bearer finance')
      .expect(400);
    expect(members).not.toHaveBeenCalled();
    await request(server)
      .get('/admin/creator-revenue/crews/crew/members?after=member-50')
      .set('Authorization', 'Bearer finance')
      .expect('Cache-Control', 'private, no-store')
      .expect(200);
    expect(members).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'admin' }),
      'crew',
      { after: 'member-50' },
    );
  });
  it('rejects a cross-currency preview for the current deployment', async () => {
    await request(server)
      .post('/admin/creator-revenue/preview')
      .set('Authorization', 'Bearer finance')
      .send({
        currency: 'CNY',
        amountMinor: '100',
        participants: [{ crewMemberId: 'member', shareBps: 10000 }],
      })
      .expect(400);
  });
  it('requires finance access and valid IDs for private revenue receipts', async () => {
    const path =
      '/admin/creator-revenue/distributions/11111111-1111-4111-8111-111111111111';
    await request(server).get(path).expect(401);
    await request(server)
      .get(path)
      .set('Authorization', 'Bearer withdrawal-only')
      .expect(403);
    await request(server)
      .get('/admin/creator-revenue/distributions/invalid')
      .set('Authorization', 'Bearer finance')
      .expect(400);
    expect(receipt).not.toHaveBeenCalled();
    await request(server)
      .get(path)
      .set('Authorization', 'Bearer finance')
      .expect('Cache-Control', 'private, no-store')
      .expect(200);
    expect(receipt).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'admin' }),
      '11111111-1111-4111-8111-111111111111',
    );
  });
  it('requires a reason and finance permission for a revenue reversal', async () => {
    const path =
      '/admin/creator-revenue/distributions/11111111-1111-4111-8111-111111111111/reverse';
    await request(server)
      .post(path)
      .set('Authorization', 'Bearer withdrawal-only')
      .send({ reason: 'Correction' })
      .expect(403);
    await request(server)
      .post(path)
      .set('Authorization', 'Bearer finance')
      .send({ reason: '' })
      .expect(400);
    await request(server)
      .post(path)
      .set('Authorization', 'Bearer finance')
      .send({ reason: 'Correction', amountMinor: '1' })
      .expect(400);
    expect(reverseRevenue).not.toHaveBeenCalled();
    await request(server)
      .post(path)
      .set('Authorization', 'Bearer finance')
      .send({ reason: 'Correction' })
      .expect('Cache-Control', 'private, no-store')
      .expect(200);
    expect(reverseRevenue).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'admin' }),
      '11111111-1111-4111-8111-111111111111',
      { reason: 'Correction' },
    );
  });
  it('passes multipart file bytes and the selected Crew with the authenticated admin', async () => {
    const buffer = Buffer.from('%PDF-1.7\nfixture\n%%EOF');
    await request(server)
      .post('/admin/creator-revenue/contracts')
      .set('Authorization', 'Bearer finance')
      .field('crewId', 'chosen-crew')
      .attach('file', buffer, 'contract.pdf')
      .expect('Cache-Control', 'private, no-store')
      .expect(201);
    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'admin' }),
      'chosen-crew',
      expect.objectContaining({ buffer, originalname: 'contract.pdf' }),
    );
  });
  it('rejects injected upload fields and invalid allocation before service execution', async () => {
    upload.mockClear();
    await request(server)
      .post('/admin/creator-revenue/contracts')
      .set('Authorization', 'Bearer finance')
      .field('crewId', 'crew')
      .field('storageKey', 'spoofed')
      .attach('file', Buffer.from('pdf'), 'contract.pdf')
      .expect(400);
    expect(upload).not.toHaveBeenCalled();
    await request(server)
      .post('/admin/creator-revenue/distributions')
      .set('Authorization', 'Bearer finance')
      .send({ contractId: 'invalid', status: 'paid' })
      .expect(400);
    expect(postRevenue).not.toHaveBeenCalled();
  });
});
