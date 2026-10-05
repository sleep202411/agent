import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { AuthGuard, AuthService } from '../auth';
import { IpCommerceController } from './ip-commerce.controller';
import { IpCommerceService } from './ip-commerce.service';
describe('Purchase complaint HTTP access', () => {
  let app: INestApplication, server: Server;
  const list = jest.fn().mockResolvedValue({ items: [], nextCursor: null });
  const report = jest.fn().mockResolvedValue({ report: { id: 'fixture' } });
  const id = '11111111-1111-4111-8111-111111111111';
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [IpCommerceController],
      providers: [
        { provide: APP_GUARD, useClass: AuthGuard },
        {
          provide: AuthService,
          useValue: {
            validateSessionContext: (cookie: string) =>
              Promise.resolve(
                cookie === 'satoken=buyer'
                  ? { user: { userId: 'buyer' }, cookie }
                  : null,
              ),
          },
        },
        {
          provide: IpCommerceService,
          useValue: { listMyReportPurchases: list, reportContent: report },
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
  it('requires a valid buyer session and does not accept an injected owner', async () => {
    await request(server).get('/ip-commerce/me/report-purchases').expect(401);
    await request(server)
      .get('/ip-commerce/me/report-purchases')
      .set('Cookie', 'satoken=expired')
      .expect(401);
    await request(server)
      .get('/ip-commerce/me/report-purchases?userId=other')
      .set('Cookie', 'satoken=buyer')
      .expect(400);
    expect(list).not.toHaveBeenCalled();
  });
  it('forwards validated search/cursor and disables caching', async () => {
    await request(server)
      .get(`/ip-commerce/me/report-purchases?query=ORDER&cursor=${id}`)
      .set('Cookie', 'satoken=buyer')
      .expect('Cache-Control', 'private, no-store')
      .expect(200);
    expect(list).toHaveBeenCalledWith(
      { userId: 'buyer' },
      { query: 'ORDER', cursor: id, limit: 20 },
    );
  });
  it('requires a purchase for payment classification and accepts a stable report request ID', async () => {
    const body = { targetType: 'ip', targetId: id, reason: 'payment' };
    await request(server).post('/ip-commerce/reports').send(body).expect(401);
    await request(server)
      .post('/ip-commerce/reports')
      .set('Cookie', 'satoken=buyer')
      .send(body)
      .expect(400);
    await request(server)
      .post('/ip-commerce/reports')
      .set('Cookie', 'satoken=buyer')
      .send({ ...body, purchaseOrderId: id, requestId: id })
      .expect(201);
    expect(report).toHaveBeenCalledWith(
      { userId: 'buyer' },
      { ...body, purchaseOrderId: id, requestId: id },
    );
  });
});
