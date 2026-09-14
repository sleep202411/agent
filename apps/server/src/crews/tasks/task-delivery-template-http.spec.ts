import { ForbiddenException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'node:http';
import { CrewTasksController } from './tasks.controller';
import { CrewTaskDraftService } from './task-draft.service';
import { CrewTasksService } from './tasks.service';

describe('task delivery template HTTP contract', () => {
  let app: INestApplication;
  const getDeliveryTemplate = jest.fn();
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CrewTasksController],
      providers: [
        { provide: CrewTaskDraftService, useValue: {} },
        { provide: CrewTasksService, useValue: { getDeliveryTemplate } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use(
      (req: { user: { userId: string } }, _res: unknown, next: () => void) => {
        req.user = { userId: 'viewer' };
        next();
      },
    );
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => getDeliveryTemplate.mockReset());

  it('serializes no template as JSON null, not an empty successful body', async () => {
    getDeliveryTemplate.mockResolvedValue(null);
    const response = await request(app.getHttpServer<Server>())
      .get('/crew-tasks/task-1/delivery-template')
      .expect(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(JSON.parse(response.text)).toBeNull();
    expect(getDeliveryTemplate).toHaveBeenCalledWith('task-1', 'viewer');
  });
  it('preserves the assigned template DTO', async () => {
    const template = {
      categoryId: 'category',
      version: 2,
      definition: { name: 'Film delivery', fields: [] },
    };
    getDeliveryTemplate.mockResolvedValue(template);
    const response = await request(app.getHttpServer<Server>())
      .get('/crew-tasks/task-1/delivery-template')
      .expect(200);
    expect(response.body).toEqual(template);
  });
  it('keeps authorization failures as errors rather than empty templates', async () => {
    getDeliveryTemplate.mockRejectedValue(
      new ForbiddenException('Crew access required'),
    );
    const response = await request(app.getHttpServer<Server>())
      .get('/crew-tasks/task-1/delivery-template')
      .expect(403);
    expect(response.body).toMatchObject({ message: 'Crew access required' });
  });
});
