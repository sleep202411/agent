import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { estimateProductModelPoints } from '@repo/shared';
import { PrismaService } from '../infra/db/db.module';
import type { AuthUser } from '../auth';
import { AiGenerationService } from '../ai-generation/ai-generation.service';
import { IpCommerceService } from './ip-commerce.service';
import { IpGenerationTemplatesService } from './ip-generation-templates.service';
import type { AiSubmitJobBody } from '../ai-generation/types';

export interface PreviewAudienceJobInput {
  referenceImageAssetId?: string;
}

export interface RunAudienceJobInput {
  referenceImageAssetId?: string;
  viewerPrompt?: string;
  idempotencyKey: string;
}

@Injectable()
export class IpGenerationJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ips: IpCommerceService,
    private readonly templates: IpGenerationTemplatesService,
    private readonly aiGeneration: AiGenerationService,
  ) {}

  private async getValidAudienceTemplate(
    ipId: string,
    templateId: string,
    user?: AuthUser,
  ) {
    await this.ips.ensurePublicEngagementTarget(user, ipId);
    const { templates } = await this.templates.getPublicTemplates(ipId, user);
    const matched = templates.find((t) => t.id === templateId);
    if (!matched) {
      throw new NotFoundException({
        code: 'TEMPLATE_NOT_FOUND',
        message: 'Audience generation template not found or not enabled.',
      });
    }

    // Load full admin template for generation fields (modelId, promptPrefix, promptSuffix, logoAssetId)
    const [row] = await this.prisma.$queryRaw<
      { audience_generation_templates: any[] | null }[]
    >`SELECT audience_generation_templates FROM ips WHERE id = ${ipId}::uuid AND deleted_at IS NULL`;
    const fullTemplate = (row?.audience_generation_templates ?? []).find(
      (t) => t.id === templateId && t.enabled,
    );
    if (!fullTemplate) {
      throw new NotFoundException({
        code: 'TEMPLATE_NOT_FOUND',
        message: 'Template configuration unavailable.',
      });
    }

    return fullTemplate;
  }

  private async validateReferenceAsset(
    user: AuthUser,
    referenceImageAssetId?: string,
  ) {
    if (!referenceImageAssetId) return null;

    const asset = await this.prisma.mediaAsset.findFirst({
      where: {
        id: referenceImageAssetId,
        createdByUserId: user.userId,
        deletedAt: null,
      },
    });

    if (!asset) {
      throw new ForbiddenException({
        code: 'ASSET_FORBIDDEN',
        message: 'Reference image not found or does not belong to you.',
      });
    }

    return asset;
  }

  private async computeTemplateCost(
    user: AuthUser,
    template: { modelId: string },
  ): Promise<{ computePoints: number; isFree: boolean; model: any }> {
    const catalog = await this.aiGeneration.listCatalog(user);
    const model = catalog.models.find((m) => m.id === template.modelId);

    if (!model) {
      throw new NotFoundException({
        code: 'MODEL_NOT_FOUND',
        message: `Model ${template.modelId} not found in catalog.`,
      });
    }

    const isCampaignFree = (catalog.campaigns ?? []).some(
      (c: any) =>
        c.status === 'active' &&
        (!c.modelId || c.modelId === template.modelId) &&
        (!c.sourceSurface || c.sourceSurface === 'ip_audience_generation'),
    );

    let points = 0;
    if (!isCampaignFree) {
      const productPricing = (model as any).billingPolicy?.productPricing;
      if (productPricing) {
        const estimate = estimateProductModelPoints({
          policy: productPricing,
          numOutputs: 1,
        });
        points = estimate.sellPoints;
      } else if ((model as any).pointsCost != null) {
        points = (model as any).pointsCost;
      }
    }

    return {
      computePoints: points,
      isFree: isCampaignFree || points === 0,
      model,
    };
  }

  async previewCost(
    user: AuthUser,
    ipId: string,
    templateId: string,
    input: PreviewAudienceJobInput,
  ) {
    const template = await this.getValidAudienceTemplate(
      ipId,
      templateId,
      user,
    );

    if (template.requireReferenceImage && !input.referenceImageAssetId) {
      throw new BadRequestException({
        code: 'REFERENCE_IMAGE_REQUIRED',
        message: 'This template requires a reference image.',
      });
    }

    await this.validateReferenceAsset(user, input.referenceImageAssetId);

    const costInfo = await this.computeTemplateCost(user, template);

    return {
      cost: {
        computePoints: costInfo.computePoints,
        accountType: 'user',
        reservedPoints: costInfo.computePoints,
        isFree: costInfo.isFree,
      },
      modelId: template.modelId,
      etaSeconds: costInfo.model.cost_estimate?.supportsPreflightEstimate
        ? 30
        : null,
    };
  }

  async runJob(
    user: AuthUser,
    ipId: string,
    templateId: string,
    input: RunAudienceJobInput,
  ) {
    const template = await this.getValidAudienceTemplate(
      ipId,
      templateId,
      user,
    );

    if (template.requireReferenceImage && !input.referenceImageAssetId) {
      throw new BadRequestException({
        code: 'REFERENCE_IMAGE_REQUIRED',
        message: 'This template requires a reference image.',
      });
    }

    const asset = await this.validateReferenceAsset(
      user,
      input.referenceImageAssetId,
    );

    const parts = [
      template.promptPrefix,
      input.viewerPrompt,
      template.promptSuffix,
    ]
      .filter((p) => Boolean(p && p.trim()))
      .join(' ');

    // Submit to canonical AI generation pipeline
    // SECURITY INVARIANT: No production workspace/project IDs are passed!
    const jobBody: AiSubmitJobBody = {
      modelId: template.modelId,
      sourceSurface: 'ip_audience_generation',
      idempotencyKey: input.idempotencyKey,
      input: {
        prompt: parts,
        aspectRatio: template.outputAspectRatio ?? '1:1',
      },
      referenceBindings: asset
        ? [
            {
              refId: asset.id,
              kind: 'image',
              role: 'reference',
              assetId: asset.id,
            },
          ]
        : undefined,
    };

    const submitRes = await this.aiGeneration.submitJob(user, jobBody);
    const costInfo = await this.computeTemplateCost(user, template);

    return {
      jobId: submitRes.request_id,
      status: submitRes.status,
      cost: {
        computePoints: costInfo.computePoints,
      },
      model: template.modelId,
    };
  }

  async getAudienceJobStatus(
    user: AuthUser,
    ipId: string,
    templateId: string,
    jobId: string,
  ) {
    await this.ips.ensurePublicEngagementTarget(user, ipId);

    // aiGeneration.getJob verifies caller ownership (user.userId === job.userId)
    // and throws 404 / 403 accordingly.
    const publicJob = await this.aiGeneration.getJob(user, jobId);

    const rawJob = await this.prisma.aiJob.findUnique({
      where: { id: jobId },
      select: { userId: true },
    });

    if (rawJob && rawJob.userId !== user.userId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN_JOB_ACCESS',
        message: 'You can only view your own generations.',
      });
    }

    return {
      id: publicJob.id,
      status: publicJob.status,
      progress: publicJob.progress,
      outputs: ((publicJob as any).outputs ?? []).map((out: any) => ({
        assetId: out.assetId,
        url: out.url,
      })),
      error: publicJob.error,
    };
  }
}
