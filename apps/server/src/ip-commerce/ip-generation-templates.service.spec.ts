import { BadRequestException, ConflictException } from '@nestjs/common';
import { IpGenerationTemplatesService } from './ip-generation-templates.service';
import type { PrismaService } from '../infra/db/db.module';
import type { IpCommerceService } from './ip-commerce.service';
import type { AiCanonicalCatalogService } from '../ai-generation/canonical-catalog.service';
import type { AuthUser } from '../auth';

describe('IpGenerationTemplatesService', () => {
  let service: IpGenerationTemplatesService;
  let mockPrisma: {
    $queryRaw: jest.Mock;
    $executeRaw: jest.Mock;
    $transaction: jest.Mock;
    mediaAsset: { findMany: jest.Mock };
  };
  let mockIps: {
    requireEditableIp: jest.Mock;
    ensurePublicEngagementTarget: jest.Mock;
  };
  let mockCatalog: { listModels: jest.Mock };

  const mockUser: AuthUser = {
    userId: 'user-00000000-0000-4000-8000-000000000001',
    roles: [],
    levelIds: [],
    orgRoles: [],
  };

  const sampleIpId = 'a0000000-0000-4000-8000-000000000001';

  beforeEach(() => {
    mockPrisma = {
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn(),
      $transaction: jest.fn((cb: (db: typeof mockPrisma) => unknown) =>
        Promise.resolve(cb(mockPrisma)),
      ),
      mediaAsset: {
        findMany: jest.fn(),
      },
    };

    mockIps = {
      requireEditableIp: jest.fn(),
      ensurePublicEngagementTarget: jest.fn(),
    };

    mockCatalog = {
      listModels: jest
        .fn()
        .mockResolvedValue([
          { id: 'model-seedance-image' },
          { id: 'model-wan-video' },
        ]),
    };

    service = new IpGenerationTemplatesService(
      mockPrisma as unknown as PrismaService,
      mockIps as unknown as IpCommerceService,
      mockCatalog as unknown as AiCanonicalCatalogService,
    );
  });

  it('create templates with valid modelIds succeeds', async () => {
    mockPrisma.$queryRaw.mockImplementation((sql: unknown) => {
      const text = Array.isArray(sql) ? sql.join(' ') : String(sql);
      if (text.includes('SELECT audience_generation_templates')) {
        return [
          {
            audience_generation_templates: [],
            version: 1,
            created_by_id: mockUser.userId,
          },
        ];
      }
      if (text.includes('UPDATE ips')) {
        return [
          {
            audience_generation_templates: [
              {
                id: 'b0000000-0000-4000-8000-000000000001',
                name: 'Poster Template',
                description: 'Awesome poster',
                modelId: 'model-seedance-image',
                promptPrefix: 'Poster of',
                promptSuffix: '',
                requireReferenceImage: true,
                referenceImageHint: 'Upload your selfie',
                outputAspectRatio: '1:1',
                logoAssetId: null,
                enabled: true,
                order: 1,
              },
            ],
            version: 2,
          },
        ];
      }
      return [];
    });

    const res = await service.updateAdminTemplates(mockUser, sampleIpId, {
      expectedVersion: 1,
      templates: [
        {
          id: 'b0000000-0000-4000-8000-000000000001',
          name: 'Poster Template',
          description: 'Awesome poster',
          modelId: 'model-seedance-image',
          promptPrefix: 'Poster of',
          promptSuffix: '',
          requireReferenceImage: true,
          referenceImageHint: 'Upload your selfie',
          outputAspectRatio: '1:1',
          logoAssetId: null,
          enabled: true,
          order: 1,
        },
      ],
    });

    expect(res.version).toBe(2);
    expect(res.templates).toHaveLength(1);
    expect(res.templates[0].name).toBe('Poster Template');
  });

  it('update with mismatched expectedVersion returns conflict', async () => {
    mockPrisma.$queryRaw.mockImplementation((sql: unknown) => {
      const text = Array.isArray(sql) ? sql.join(' ') : String(sql);
      if (text.includes('SELECT audience_generation_templates')) {
        return [
          {
            audience_generation_templates: [],
            version: 5,
            created_by_id: mockUser.userId,
          },
        ];
      }
      if (text.includes('UPDATE ips')) {
        // Version condition didn't match so zero rows returned
        return [];
      }
      return [];
    });

    await expect(
      service.updateAdminTemplates(mockUser, sampleIpId, {
        expectedVersion: 1, // Mismatched
        templates: [],
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('update with unknown modelId rejects the whole batch', async () => {
    await expect(
      service.updateAdminTemplates(mockUser, sampleIpId, {
        expectedVersion: 1,
        templates: [
          {
            id: 'b0000000-0000-4000-8000-000000000001',
            name: 'Invalid Template',
            description: '',
            modelId: 'unknown-alien-model',
            promptPrefix: '',
            promptSuffix: '',
            requireReferenceImage: false,
            referenceImageHint: '',
            outputAspectRatio: '16:9',
            logoAssetId: null,
            enabled: true,
            order: 0,
          },
        ],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('public read filters out disabled templates and strips sensitive fields', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      {
        audience_generation_templates: [
          {
            id: 'b0000000-0000-4000-8000-000000000001',
            name: 'Public Template',
            description: 'Public description',
            modelId: 'model-seedance-image',
            promptPrefix: 'SECRET PROMPT PREFIX',
            promptSuffix: 'SECRET PROMPT SUFFIX',
            requireReferenceImage: true,
            referenceImageHint: 'Your photo',
            outputAspectRatio: '9:16',
            logoAssetId: 'c0000000-0000-4000-8000-000000000001',
            enabled: true,
            order: 2,
          },
          {
            id: 'b0000000-0000-4000-8000-000000000002',
            name: 'Disabled Template',
            description: 'Should not show',
            modelId: 'model-wan-video',
            promptPrefix: '',
            promptSuffix: '',
            requireReferenceImage: false,
            referenceImageHint: '',
            outputAspectRatio: '16:9',
            logoAssetId: null,
            enabled: false,
            order: 1,
          },
        ],
        version: 3,
        created_by_id: mockUser.userId,
      },
    ]);

    const res = await service.getPublicTemplates(sampleIpId);

    expect(res.templates).toHaveLength(1);
    const pub = res.templates[0];
    expect(pub.id).toBe('b0000000-0000-4000-8000-000000000001');
    expect(pub.name).toBe('Public Template');
    expect(pub).not.toHaveProperty('promptPrefix');
    expect(pub).not.toHaveProperty('promptSuffix');
    expect(pub).not.toHaveProperty('logoAssetId');
    expect(pub).not.toHaveProperty('enabled');
    expect(pub).not.toHaveProperty('modelId');
  });
});
