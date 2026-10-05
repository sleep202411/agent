import {
  CreatorWithdrawalProofsController,
  WithdrawalProofsController,
} from './withdrawal-proofs.controller';
import { WithdrawalProofsService } from './withdrawal-proofs.service';
import { RevenueDraftsService } from './revenue-drafts.service';
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
  const creatorProofDownload = jest
    .fn()
    .mockResolvedValue({ url: 'https://storage.invalid/read' });
  const proofUpload = jest.fn().mockResolvedValue({ id: 'proof' });
  const proofDownload = jest
    .fn()
    .mockResolvedValue({ url: 'https://storage.invalid/read' });
  const balances = jest
    .fn<Promise<unknown[]>, [string]>()
    .mockResolvedValue([]);
  const exportCsv = jest.fn().mockResolvedValue({
    csv: 'fixture',
    filename: 'withdrawals.csv',
    count: 0,
  });
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
        WithdrawalProofsController,
        CreatorWithdrawalProofsController,
      ],
      providers: [
        {
          provide: WithdrawalProofsService,
          useValue: {
            upload: proofUpload,
            download: proofDownload,
            downloadForCreator: creatorProofDownload,
          },
        },
        {
          provide: RevenueDraftsService,
          useValue: {
            get: jest.fn().mockResolvedValue({ revision: 0, data: null }),
            save: jest.fn().mockResolvedValue({ revision: 1, data: null }),
          },
        },
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
        { provide: WithdrawalAdminService, useValue: { queue, exportCsv } },
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
  it('authenticates creator proof access and takes ownership only from the session', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const path = `/me/withdrawals/${id}/payment-proof/download`;
    await request(server).post(path).expect(401);
    await request(server)
      .post(path)
      .set('Authorization', 'Bearer finance')
      .expect(401);
    await request(server)
      .post('/me/withdrawals/invalid/payment-proof/download')
      .set('Cookie', 'satoken=creator')
      .expect(400);
    const response = await request(server)
      .post(path)
      .set('Cookie', 'satoken=creator')
      .send({ userId: 'another-user' })
      .expect(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(creatorProofDownload).toHaveBeenLastCalledWith(
      'verified-creator',
      id,
    );
  });
  it('protects proof uploads with the finance guard and accepts one bounded file', async () => {
    const path =
      '/admin/creator-withdrawals/11111111-1111-4111-8111-111111111111/proofs';
    await request(server).post(path).expect(401);
    await request(server)
      .post(path)
      .set('Cookie', 'fd_admin_session=ordinary')
      .expect(403);
    const bytes = Buffer.from('%PDF-1.7\n%%EOF');
    await request(server)
      .post(path)
      .set('Cookie', 'fd_admin_session=finance')
      .attach('file', bytes, 'proof.pdf')
      .expect('Cache-Control', 'private, no-store')
      .expect(201);
    expect(proofUpload).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'admin' }),
      '11111111-1111-4111-8111-111111111111',
      expect.objectContaining({ buffer: bytes, originalname: 'proof.pdf' }),
    );
    await request(server)
      .post(path)
      .set('Cookie', 'fd_admin_session=finance')
      .attach('file', Buffer.alloc(10 * 1024 * 1024 + 1), 'large.pdf')
      .expect(413);
    await request(server)
      .post(path)
      .set('Cookie', 'fd_admin_session=finance')
      .field('withdrawalId', 'injected')
      .attach('file', bytes, 'proof.pdf')
      .expect(400);
  });
  it('requires finance access and UUID scope for proof download links', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    await request(server)
      .post(`/admin/creator-withdrawals/${id}/proofs/${id}/download`)
      .set('Cookie', 'fd_admin_session=ordinary')
      .expect(403);
    await request(server)
      .post(`/admin/creator-withdrawals/${id}/proofs/invalid/download`)
      .set('Cookie', 'fd_admin_session=finance')
      .expect(400);
    await request(server)
      .post(`/admin/creator-withdrawals/${id}/proofs/${id}/download`)
      .set('Cookie', 'fd_admin_session=finance')
      .expect('Cache-Control', 'private, no-store')
      .expect(200);
    expect(proofDownload).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'admin' }),
      id,
      id,
    );
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
  it('protects filtered CSV exports and routes them before UUID details', async () => {
    await request(server).get('/admin/creator-withdrawals/export').expect(401);
    await request(server)
      .get('/admin/creator-withdrawals/export')
      .set('Authorization', 'Bearer ordinary')
      .expect(403);
    await request(server)
      .get('/admin/creator-withdrawals/export?currency=USD&minAmountMinor=29')
      .set('Authorization', 'Bearer finance')
      .expect('Cache-Control', 'private, no-store')
      .expect(200);
    expect(exportCsv).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'admin' }),
      { currency: 'USD', minAmountMinor: '29', page: 1 },
    );
    await request(server)
      .get('/admin/creator-withdrawals/export?minAmountMinor=29')
      .set('Authorization', 'Bearer finance')
      .expect(400);
    expect(exportCsv).toHaveBeenCalledTimes(1);
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
  it('protects private income drafts with revenue permission and validates revisions', async () => {
    const path = '/admin/creator-revenue/crews/crew/draft';
    await request(server).get(path).expect(401);
    await request(server)
      .get(path)
      .set('Authorization', 'Bearer withdrawal-only')
      .expect(403);
    await request(server)
      .get(path)
      .set('Authorization', 'Bearer finance')
      .expect('Cache-Control', 'private, no-store')
      .expect(200);
    await request(server)
      .post(path)
      .set('Authorization', 'Bearer withdrawal-only')
      .send({ revision: 0, data: null })
      .expect(403);
    await request(server)
      .post(path)
      .set('Authorization', 'Bearer finance')
      .send({ revision: -1, data: null })
      .expect(400);
    await request(server)
      .post(path)
      .set('Authorization', 'Bearer finance')
      .send({ revision: 0, data: null })
      .expect('Cache-Control', 'private, no-store')
      .expect(200);
  });
});
