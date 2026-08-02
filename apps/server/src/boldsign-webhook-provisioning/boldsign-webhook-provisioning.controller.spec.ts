import { ServiceUnavailableException } from '@nestjs/common';
import { BoldSignWebhookProvisioningController } from './boldsign-webhook-provisioning.controller';

describe('BoldSignWebhookProvisioningController', () => {
  const controller = new BoldSignWebhookProvisioningController();

  it('acknowledges the exact BoldSign verification probe', () => {
    expect(controller.verify('Verification')).toEqual({
      received: true,
      verification: true,
    });
  });

  it.each([
    ['missing header', undefined],
    ['ordinary event', 'Completed'],
  ])('rejects %s', (_label, header) => {
    expect(() => controller.verify(header)).toThrow(
      ServiceUnavailableException,
    );
  });
});
