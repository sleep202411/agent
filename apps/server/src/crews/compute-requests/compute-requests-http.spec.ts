import { ProjectBudgetService } from './project-budget.service';
import { ForbiddenException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { AdminAuthService } from '../../admin-auth';
import { CrewComputeRequestsAdminController } from './compute-requests-admin.controller';
import { CrewComputeRequestsController } from './compute-requests.controller';
import { CrewComputeRequestsService } from './compute-requests.service';

describe('Admin-only compute request HTTP boundary', () => {
  let app: INestApplication;
  const validateSession = jest.fn();
  const listAdmin = jest.fn().mockResolvedValue({ items: [] });
  const decideAdmin = jest.fn().mockResolvedValue({ status: 'approved' });
  const crewId = randomUUID(),
    requestId = randomUUID();
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [
        CrewComputeRequestsController,
        CrewComputeRequestsAdminController,
      ],
      providers: [
        {
          provide: ProjectBudgetService,
          useValue: { detail: jest.fn(), change: jest.fn() },
        },
        { provide: AdminAuthService, useValue: { validateSession } },
        {
          provide: CrewComputeRequestsService,
          useValue: { listAdmin, decideAdmin },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    jest.clearAllMocks();
  });
  it('rejects the legacy Crew decision route regardless of user role', async () => {
    await request(app.getHttpServer() as Server)
      .post(`/crews/${crewId}/compute-requests/${requestId}/decision`)
      .send({ status: 'approved', note: '', isOwner: true })
      .expect(403);
    expect(decideAdmin).not.toHaveBeenCalled();
  });
  it('rejects ordinary user sessions on Admin list and decision routes', async () => {
    validateSession.mockRejectedValue(
      new ForbiddenException('Admin session required'),
    );
    await request(app.getHttpServer() as Server)
      .get('/admin/crew-compute-requests')
      .expect(403);
    await request(app.getHttpServer() as Server)
      .get('/admin/crew-compute-requests/projects')
      .expect(403);
    await request(app.getHttpServer() as Server)
      .post(`/admin/crew-compute-requests/${crewId}/${requestId}/decision`)
      .send({ status: 'approved' })
      .expect(403);
    await request(app.getHttpServer() as Server)
      .get(`/admin/crew-compute-requests/${crewId}/budget`)
      .expect(403);
    await request(app.getHttpServer() as Server)
      .post(`/admin/crew-compute-requests/${crewId}/budget`)
      .send({ action: 'close' })
      .expect(403);
    expect(listAdmin).not.toHaveBeenCalled();
    expect(decideAdmin).not.toHaveBeenCalled();
  });
  it('rejects an Admin without compute review permission', async () => {
    validateSession.mockResolvedValue({
      id: randomUUID(),
      permissions: ['crew.manage', 'billing.write'],
      roleKeys: ['crew_manager'],
    });
    await request(app.getHttpServer() as Server)
      .post(`/admin/crew-compute-requests/${crewId}/${requestId}/decision`)
      .send({ status: 'approved' })
      .expect(403);
    expect(decideAdmin).not.toHaveBeenCalled();
  });
  it('uses the authenticated Admin identity, validates IDs and ignores submitted actor fields', async () => {
    const admin = { id: randomUUID(), permissions: ['crew.compute.review'] };
    validateSession.mockResolvedValue(admin);
    await request(app.getHttpServer() as Server)
      .post(`/admin/crew-compute-requests/${crewId}/invalid/decision`)
      .send({ status: 'approved' })
      .expect(400);
    await request(app.getHttpServer() as Server)
      .post(`/admin/crew-compute-requests/${crewId}/${requestId}/decision`)
      .send({ status: 'approved', decidedByAdminId: 'forged' })
      .expect(201);
    expect(decideAdmin).toHaveBeenCalledWith(crewId, requestId, admin, {
      status: 'approved',
      note: '',
    });
  });
});
