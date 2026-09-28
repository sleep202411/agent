import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { IpGenerationJobsService } from './ip-generation-jobs.service';
import type { PrismaService } from '../infra/db/db.module';
import type { IpCommerceService } from './ip-commerce.service';
import type { IpGenerationTemplatesService } from './ip-generation-templates.service';
import type { AiGenerationService } from '../ai-generation/ai-generation.service';
import type { AuthUser } from '../auth';

describe('IpGenerationJobsService', () => {
  let service: IpGenerationJobsService;
  let mockPrisma: {
    $queryRaw: jest.Mock;
    mediaAsset: { findFirst: jest.Mock };
    aiJob: { findUnique: jest.Mock };
  };
  let mockIps: { ensurePublicEngagementTarget: jest.Mock };
  let mockTemplates: { getPublicTemplates: jest.Mock };
  let mockAiGeneration: {
    listCatalog: jest.Mock;
    submitJob: jest.Mock<
      Promise<unknown>,
      Parameters<AiGenerationService['submitJob']>
    >;
    getJob: jest.Mock;
  };

  const mockUser: AuthUser = {
    userId: 'user-00000000-0000-4000-8000-000000000001',
    roles: [],
    levelIds: [],
    orgRoles: [],
  };

  const sampleIpId = 'a0000000-0000-4000-8000-000000000001';
  const sampleTemplateId = 'b0000000-0000-4000-8000-000000000002';
  const sampleAssetId = 'c0000000-0000-4000-8000-000000000003';

  beforeEach(() => {
    mockPrisma = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          audience_generation_templates: [
            {
              id: sampleTemplateId,
              name: 'Anime Style',
              modelId: 'model-seedance-image',
              promptPrefix: 'Anime portrait of',
              promptSuffix: 'highly detailed',
              requireReferenceImage: true,
              enabled: true,
              outputAspectRatio: '1:1',
            },
          ],
        },
      ]),
      mediaAsset: {
        findFirst: jest
          .fn()
          .mockImplementation(
            ({
              where,
            }: {
              where: { id: string; createdByUserId?: string };
            }) => {
              if (
                where.id === sampleAssetId &&
                where.createdByUserId === mockUser.userId
              ) {
                return Promise.resolve({
                  id: sampleAssetId,
                  createdByUserId: mockUser.userId,
                });
              }
              return Promise.resolve(null);
            },
          ),
      },
      aiJob: {
        findUnique: jest
          .fn()
          .mockImplementation(
            ({
              where,
            }: {
              where: { id: string; createdByUserId?: string };
            }) => {
              if (where.id === 'job-other') {
                return Promise.resolve({
                  id: 'job-other',
                  userId: 'someone-else-id',
                });
              }
              return Promise.resolve({ id: where.id, userId: mockUser.userId });
            },
          ),
      },
    };

    mockIps = {
      ensurePublicEngagementTarget: jest.fn().mockResolvedValue(undefined),
    };

    mockTemplates = {
      getPublicTemplates: jest.fn().mockResolvedValue({
        templates: [
          {
            id: sampleTemplateId,
            name: 'Anime Style',
            requireReferenceImage: true,
            enabled: true,
          },
        ],
      }),
    };

    mockAiGeneration = {
      listCatalog: jest.fn().mockResolvedValue({
        models: [
          {
            id: 'model-seedance-image',
            cost_estimate: { supportsPreflightEstimate: true },
            billing_policy: {
              productPricing: {
                mode: 'fixed_per_output',
                pointsPerOutput: 15,
              },
            },
          },
        ],
        campaigns: [],
      }),
      submitJob: jest
        .fn<Promise<unknown>, Parameters<AiGenerationService['submitJob']>>()
        .mockResolvedValue({
          request_id: 'job-123',
          status: 'queued',
        }),
      getJob: jest.fn().mockResolvedValue({
        id: 'job-123',
        status: 'completed',
        progress: 100,
        outputs: [{ assetId: 'out-1', url: 'https://example.com/out.png' }],
      }),
    };

    service = new IpGenerationJobsService(
      mockPrisma as unknown as PrismaService,
      mockIps as unknown as IpCommerceService,
      mockTemplates as unknown as IpGenerationTemplatesService,
      mockAiGeneration as unknown as AiGenerationService,
    );
  });

  it('Preview returns real cost from pricing policy when no campaign matches', async () => {
    const res = await service.previewCost(
      mockUser,
      sampleIpId,
      sampleTemplateId,
      {
        referenceImageAssetId: sampleAssetId,
      },
    );
    expect(res.cost.computePoints).toBe(15);
    expect(res.cost.isFree).toBe(false);
    expect(res.modelId).toBe('model-seedance-image');
  });

  it('Preview correctly returns dynamic cost for models with different points values (e.g. 25)', async () => {
    mockAiGeneration.listCatalog.mockResolvedValueOnce({
      models: [
        {
          id: 'model-seedance-image',
          cost_estimate: { supportsPreflightEstimate: true },
          billing_policy: {
            productPricing: {
              mode: 'fixed_per_output',
              pointsPerOutput: 25,
            },
          },
        },
      ],
      campaigns: [],
    });

    const res = await service.previewCost(
      mockUser,
      sampleIpId,
      sampleTemplateId,
      {
        referenceImageAssetId: sampleAssetId,
      },
    );
    expect(res.cost.computePoints).toBe(25);
    expect(res.cost.isFree).toBe(false);
  });

  it('does not apply catalog campaigns that are not selected by submission', async () => {
    mockAiGeneration.listCatalog.mockResolvedValueOnce({
      models: [
        {
          id: 'model-seedance-image',
          billing_policy: {
            productPricing: {
              mode: 'fixed_per_output',
              pointsPerOutput: 15,
            },
          },
        },
      ],
      campaigns: [
        {
          campaignId: 'free-images',
          eligibleModelIds: ['model-seedance-image'],
        },
      ],
    });

    const res = await service.previewCost(
      mockUser,
      sampleIpId,
      sampleTemplateId,
      {
        referenceImageAssetId: sampleAssetId,
      },
    );
    expect(res.cost.computePoints).toBe(15);
    expect(res.cost.isFree).toBe(false);
  });

  it('honors an explicitly free model billing policy', async () => {
    mockAiGeneration.listCatalog.mockResolvedValueOnce({
      models: [
        { id: 'model-seedance-image', billing_policy: { mode: 'free' } },
      ],
      campaigns: [],
    });
    const result = await service.previewCost(
      mockUser,
      sampleIpId,
      sampleTemplateId,
      {
        referenceImageAssetId: sampleAssetId,
      },
    );
    expect(result.cost).toMatchObject({ computePoints: 0, isFree: true });
  });

  it('rejects missing product pricing before submitting a job', async () => {
    mockAiGeneration.listCatalog.mockResolvedValueOnce({
      models: [
        { id: 'model-seedance-image', billing_policy: { mode: 'charge' } },
      ],
      campaigns: [],
    });
    await expect(
      service.runJob(mockUser, sampleIpId, sampleTemplateId, {
        referenceImageAssetId: sampleAssetId,
        idempotencyKey: 'missing-pricing',
      }),
    ).rejects.toThrow('This model is missing product pricing.');
    expect(mockAiGeneration.submitJob).not.toHaveBeenCalled();
  });

  it('previewCost and runJob return the same computePoints when called with the same template and catalog', async () => {
    const previewRes = await service.previewCost(
      mockUser,
      sampleIpId,
      sampleTemplateId,
      {
        referenceImageAssetId: sampleAssetId,
      },
    );

    const runRes = await service.runJob(
      mockUser,
      sampleIpId,
      sampleTemplateId,
      {
        referenceImageAssetId: sampleAssetId,
        viewerPrompt: 'smiling',
        idempotencyKey: 'idem-agree-1',
      },
    );

    expect(previewRes.cost.computePoints).toBe(runRes.cost.computePoints);
    expect(runRes.cost.computePoints).toBe(15);
  });

  it('Run rejects if requireReferenceImage is true and no referenceImageAssetId provided', async () => {
    await expect(
      service.runJob(mockUser, sampleIpId, sampleTemplateId, {
        idempotencyKey: 'idem-1',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('Run rejects if referenceImageAssetId belongs to another user', async () => {
    await expect(
      service.runJob(mockUser, sampleIpId, sampleTemplateId, {
        referenceImageAssetId: 'alien-asset-id',
        idempotencyKey: 'idem-2',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('Run builds AiSubmitJobBody with workspaceId/projectId/storyProjectId/documentId all null or undefined', async () => {
    const runRes = await service.runJob(
      mockUser,
      sampleIpId,
      sampleTemplateId,
      {
        referenceImageAssetId: sampleAssetId,
        viewerPrompt: 'smiling',
        idempotencyKey: 'idem-3',
      },
    );

    expect(mockAiGeneration.submitJob).toHaveBeenCalledTimes(1);
    const submittedBody = mockAiGeneration.submitJob.mock.calls[0][1];

    // Security invariant verification
    expect(submittedBody.workspaceId).toBeUndefined();
    expect(submittedBody.projectId).toBeUndefined();
    expect(submittedBody.storyProjectId).toBeUndefined();
    expect(submittedBody.documentId).toBeUndefined();
    expect(submittedBody.documentBlockId).toBeUndefined();
    expect(submittedBody.sourceSurface).toBe('ip_audience_generation');
    expect(submittedBody.input.prompt).toContain(
      'Anime portrait of smiling highly detailed',
    );

    // Cost verification
    expect(runRes.cost.computePoints).toBe(15);
  });

  it.each(['unavailable', 'missing-model'])(
    'does not submit a paid job when the response cost catalog is %s',
    async (failure) => {
      if (failure === 'unavailable') {
        mockAiGeneration.listCatalog.mockRejectedValueOnce(
          new Error('Catalog unavailable'),
        );
      } else {
        mockAiGeneration.listCatalog.mockResolvedValueOnce({
          models: [],
          campaigns: [],
        });
      }
      await expect(
        service.runJob(mockUser, sampleIpId, sampleTemplateId, {
          referenceImageAssetId: sampleAssetId,
          idempotencyKey: 'catalog-failure',
        }),
      ).rejects.toThrow();
      expect(mockAiGeneration.submitJob).not.toHaveBeenCalled();
    },
  );

  it('finishes catalog validation before submitting and returns the accepted job', async () => {
    const result = await service.runJob(
      mockUser,
      sampleIpId,
      sampleTemplateId,
      {
        referenceImageAssetId: sampleAssetId,
        idempotencyKey: 'accepted-job',
      },
    );
    expect(mockAiGeneration.listCatalog).toHaveBeenCalledTimes(1);
    expect(
      mockAiGeneration.listCatalog.mock.invocationCallOrder[0],
    ).toBeLessThan(mockAiGeneration.submitJob.mock.invocationCallOrder[0]);
    expect(result).toMatchObject({
      jobId: 'job-123',
      cost: { computePoints: 15 },
    });
  });

  it('Status returns 403 if caller is not the job owner', async () => {
    mockAiGeneration.getJob.mockResolvedValueOnce({
      id: 'job-other',
      status: 'completed',
    });

    await expect(
      service.getAudienceJobStatus(
        mockUser,
        sampleIpId,
        sampleTemplateId,
        'job-other',
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});
