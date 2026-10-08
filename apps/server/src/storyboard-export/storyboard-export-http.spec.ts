import type { INestApplication } from '@nestjs/common';
import { ServiceUnavailableException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'node:http';
import { AuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { StoryboardExportController } from './storyboard-export.controller';
import { StoryboardExportJobsService } from './storyboard-export-jobs.service';
import { StoryboardExportOutputService } from './storyboard-export-output.service';
describe('storyboard export HTTP boundary', () => {
  let app: INestApplication;
  const jobs = {
    list: jest.fn(),
    create: jest.fn(),
    get: jest.fn(),
    cancel: jest.fn(),
  };
  const outputs = { download: jest.fn(), assertConfigured: jest.fn() };
  const id = '11111111-1111-4111-8111-111111111111';
  const input = {
    requestId: id,
    documentId: id,
    expectedSequence: 1,
    width: 1280,
    height: 720,
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [StoryboardExportController],
      providers: [
        { provide: StoryboardExportJobsService, useValue: jobs },
        { provide: StoryboardExportOutputService, useValue: outputs },
        {
          provide: AuthService,
          useValue: {
            validateSessionContext: (cookie: string) =>
              Promise.resolve(
                cookie === 'satoken=fixture'
                  ? { user: { userId: 'verified-owner' }, cookie }
                  : null,
              ),
          },
        },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    jest.clearAllMocks();
    for (const fn of [...Object.values(jobs), ...Object.values(outputs)])
      fn.mockResolvedValue({ id });
  });
  it('requires a valid session on every route', async () => {
    for (const cookie of ['', 'satoken=expired']) {
      await request(app.getHttpServer() as Server)
        .post('/storyboard-exports')
        .set('Cookie', cookie)
        .send(input)
        .expect(401);
      await request(app.getHttpServer() as Server)
        .get(`/storyboard-exports/${id}`)
        .set('Cookie', cookie)
        .expect(401);
      for (const suffix of ['cancel', 'download'])
        await request(app.getHttpServer() as Server)
          .post(`/storyboard-exports/${id}/${suffix}`)
          .set('Cookie', cookie)
          .expect(401);
    }
    expect(jobs.create).not.toHaveBeenCalled();
    expect(outputs.download).not.toHaveBeenCalled();
  });
  it('binds all actions to the verified account and prevents download caching', async () => {
    await request(app.getHttpServer() as Server)
      .post('/storyboard-exports')
      .set('Cookie', 'satoken=fixture')
      .send(input)
      .expect(200);
    await request(app.getHttpServer() as Server)
      .get(`/storyboard-exports?documentId=${id}`)
      .set('Cookie', 'satoken=fixture')
      .expect(200)
      .expect('Cache-Control', 'private, no-store');
    expect(jobs.list).toHaveBeenCalledWith('verified-owner', id);
    expect(jobs.create).toHaveBeenCalledWith('verified-owner', input);
    await request(app.getHttpServer() as Server)
      .get(`/storyboard-exports/${id}`)
      .set('Cookie', 'satoken=fixture')
      .expect(200)
      .expect('Cache-Control', 'private, no-store');
    expect(jobs.get).toHaveBeenCalledWith('verified-owner', id);
    await request(app.getHttpServer() as Server)
      .post(`/storyboard-exports/${id}/cancel`)
      .set('Cookie', 'satoken=fixture')
      .expect(200);
    expect(jobs.cancel).toHaveBeenCalledWith('verified-owner', id);
    await request(app.getHttpServer() as Server)
      .post(`/storyboard-exports/${id}/download`)
      .set('Cookie', 'satoken=fixture')
      .expect(200)
      .expect('Cache-Control', 'private, no-store');
    expect(outputs.download).toHaveBeenCalledWith('verified-owner', id);
  });
  it('does not enqueue a render when private storage is not configured', async () => {
    outputs.assertConfigured.mockRejectedValueOnce(
      new ServiceUnavailableException(
        'S3_PRIVATE_BUCKET must name a separate private upload destination',
      ),
    );
    await request(app.getHttpServer() as Server)
      .post('/storyboard-exports')
      .set('Cookie', 'satoken=fixture')
      .send(input)
      .expect(503);
    expect(jobs.create).not.toHaveBeenCalled();
  });
  it('rejects spoofed identities, invalid dimensions and malformed IDs', async () => {
    for (const value of [
      { ...input, userId: 'other' },
      { ...input, width: 1279 },
      { ...input, height: 4000 },
      { ...input, expectedSequence: -1 },
      { ...input, sourceUrl: 'https://arbitrary.invalid' },
    ])
      await request(app.getHttpServer() as Server)
        .post('/storyboard-exports')
        .set('Cookie', 'satoken=fixture')
        .send(value)
        .expect(400);
    await request(app.getHttpServer() as Server)
      .get('/storyboard-exports/bad')
      .set('Cookie', 'satoken=fixture')
      .expect(400);
    expect(jobs.create).not.toHaveBeenCalled();
    expect(jobs.get).not.toHaveBeenCalled();
  });
});
