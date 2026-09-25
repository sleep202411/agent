import {
  CrewDisputeAttachmentsAdminController,
  CrewDisputeAttachmentsService,
} from './dispute-attachments';
import { ForbiddenException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  ADMIN_PERMISSION_KEYS,
  AdminAuthService,
  type AdminActor,
} from '../../admin-auth';
import {
  CrewTaskDisputesAdminController,
  CrewTaskDisputesService,
} from './task-disputes';

describe('Dispute operations HTTP authorization', () => {
  let app: INestApplication;
  const validateSession = jest.fn();
  const list = jest.fn().mockResolvedValue({ items: [], nextBeforeId: null });
  const update = jest.fn().mockResolvedValue({ status: 'in_review' });
  const read = jest
    .fn()
    .mockResolvedValue({ url: 'https://fixture.invalid/private-read' });
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [
        CrewTaskDisputesAdminController,
        CrewDisputeAttachmentsAdminController,
      ],
      providers: [
        { provide: AdminAuthService, useValue: { validateSession } },
        { provide: CrewTaskDisputesService, useValue: { list, update } },
        { provide: CrewDisputeAttachmentsService, useValue: { list, read } },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    validateSession.mockReset();
    list.mockClear();
    update.mockClear();
    read.mockClear();
  });
  it('protects attachment lists and downloads with operations permissions', async () => {
    validateSession.mockResolvedValue({ id: randomUUID(), permissions: [] });
    const base = `/admin/crew-disputes/${randomUUID()}/attachments`;
    await request(app.getHttpServer() as Server)
      .get(base)
      .expect(403);
    await request(app.getHttpServer() as Server)
      .get(`${base}/${randomUUID()}/read`)
      .expect(403);
    expect(read).not.toHaveBeenCalled();
  });
  it('validates attachment IDs and prevents caching authorized read links', async () => {
    const admin = {
      id: randomUUID(),
      permissions: [ADMIN_PERMISSION_KEYS.CrewManage],
    };
    validateSession.mockResolvedValue(admin);
    const caseId = randomUUID(),
      attachmentId = randomUUID();
    const base = `/admin/crew-disputes/${caseId}/attachments`;
    await request(app.getHttpServer() as Server)
      .get(`${base}/invalid/read`)
      .expect(400);
    const response = await request(app.getHttpServer() as Server)
      .get(`${base}/${attachmentId}/read`)
      .expect(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(read).toHaveBeenCalledWith(caseId, attachmentId, {
      kind: 'admin',
      admin,
    });
  });
  it('rejects missing admin authentication before exposing the queue', async () => {
    validateSession.mockRejectedValue(
      new ForbiddenException('Admin session required'),
    );
    await request(app.getHttpServer() as Server)
      .get('/admin/crew-disputes')
      .expect(403);
    expect(list).not.toHaveBeenCalled();
  });
  it('enforces Crew management permission on reads and writes', async () => {
    validateSession.mockResolvedValue({
      id: randomUUID(),
      permissions: [],
    } as Partial<AdminActor>);
    await request(app.getHttpServer() as Server)
      .get('/admin/crew-disputes')
      .expect(403);
    await request(app.getHttpServer() as Server)
      .post(`/admin/crew-disputes/${randomUUID()}/events`)
      .send({})
      .expect(403);
    expect(update).not.toHaveBeenCalled();
  });
  it('validates decisions and forwards only the authenticated actor', async () => {
    const admin = {
      id: randomUUID(),
      permissions: [ADMIN_PERMISSION_KEYS.CrewManage],
    } as Partial<AdminActor>;
    validateSession.mockResolvedValue(admin);
    const id = randomUUID();
    await request(app.getHttpServer() as Server)
      .post(`/admin/crew-disputes/${id}/events`)
      .send({ action: 'resolve' })
      .expect(400);
    const body = {
      requestKey: randomUUID(),
      expectedVersion: 1,
      action: 'claim',
      message: 'I will review this case',
      submissionIds: [],
    };
    await request(app.getHttpServer() as Server)
      .post(`/admin/crew-disputes/${id}/events`)
      .send(body)
      .expect(201);
    expect(update).toHaveBeenCalledWith(id, { kind: 'admin', admin }, body);
  });
});
