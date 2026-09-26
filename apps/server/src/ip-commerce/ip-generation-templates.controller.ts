import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, Public, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  UpdateAudienceGenerationTemplatesSchema,
  type UpdateAudienceGenerationTemplatesDto,
} from './ip-generation-template.dto';
import { IpGenerationTemplatesService } from './ip-generation-templates.service';

const Params = z.object({ ipId: z.string().uuid() });

@Controller('ip-commerce')
export class IpGenerationTemplatesController {
  constructor(private readonly service: IpGenerationTemplatesService) {}

  @Get('me/ips/:ipId/generation-templates')
  async getAdminTemplates(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(Params)) params: z.infer<typeof Params>,
  ) {
    return {
      code: 200,
      data: await this.service.getAdminTemplates(user, params.ipId),
    };
  }

  @Put('me/ips/:ipId/generation-templates')
  async updateAdminTemplates(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(Params)) params: z.infer<typeof Params>,
    @Body(new ZodValidationPipe(UpdateAudienceGenerationTemplatesSchema))
    input: UpdateAudienceGenerationTemplatesDto,
  ) {
    return {
      code: 200,
      data: await this.service.updateAdminTemplates(user, params.ipId, input),
    };
  }

  @Public()
  @Get('ips/:ipId/generation-templates')
  async getPublicTemplates(
    @Param(new ZodValidationPipe(Params)) params: z.infer<typeof Params>,
    @CurrentUser() user?: AuthUser,
  ) {
    return {
      code: 200,
      data: await this.service.getPublicTemplates(params.ipId, user),
    };
  }
}
