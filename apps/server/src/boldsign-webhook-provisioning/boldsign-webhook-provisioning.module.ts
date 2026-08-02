import { Module } from '@nestjs/common';
import { BoldSignWebhookProvisioningController } from './boldsign-webhook-provisioning.controller';

@Module({ controllers: [BoldSignWebhookProvisioningController] })
export class BoldSignWebhookProvisioningModule {}
