import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type Redis from 'ioredis';
import {
  EMERGENCY_BLOCKED_USER_IDS_KEY,
  EmergencyAccessBlockService,
  isEmergencyBulkSignupEmail,
} from './emergency-access-block.service';

describe('EmergencyAccessBlockService', () => {
  const previous = process.env.EMERGENCY_USER_BLOCKLIST_ENABLED;
  const sismember = jest.fn();
  const redis = { sismember } as unknown as Redis;

  beforeEach(() => {
    process.env.EMERGENCY_USER_BLOCKLIST_ENABLED = 'true';
    sismember.mockReset().mockResolvedValue(0);
  });

  afterAll(() => {
    if (previous === undefined)
      delete process.env.EMERGENCY_USER_BLOCKLIST_ENABLED;
    else process.env.EMERGENCY_USER_BLOCKLIST_ENABLED = previous;
  });

  it('rejects an exact user ID in the shared blocklist', async () => {
    sismember.mockResolvedValue(1);
    const service = new EmergencyAccessBlockService(redis);
    await expect(
      service.assertAllowed({ userId: '16591' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(sismember).toHaveBeenCalledWith(
      EMERGENCY_BLOCKED_USER_IDS_KEY,
      '16591',
    );
  });

  it('blocks the observed bulk-signup pattern before a new ID is listed', async () => {
    const service = new EmergencyAccessBlockService(redis);
    await expect(
      service.assertAllowed({
        userId: 'future',
        email: 'mue7i8qwa5id@ve0ai.com',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(sismember).not.toHaveBeenCalled();
  });

  it('allows unrelated users and fails closed if Redis is unavailable', async () => {
    const service = new EmergencyAccessBlockService(redis);
    await expect(
      service.assertAllowed({
        userId: 'known-good',
        email: 'person@example.com',
      }),
    ).resolves.toBeUndefined();
    sismember.mockRejectedValue(new Error('redis unavailable'));
    await expect(
      service.assertAllowed({ userId: 'known-good' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('does not block only by domain or prefix', () => {
    expect(isEmergencyBulkSignupEmail('ordinary@imgfx.art')).toBe(false);
    expect(isEmergencyBulkSignupEmail('mue7i8qwa5id@example.com')).toBe(false);
    expect(isEmergencyBulkSignupEmail('mue7i8qwa5id@ve0ai.com')).toBe(true);
    expect(isEmergencyBulkSignupEmail('mufn87itujir@animatimg.com')).toBe(true);
    expect(
      isEmergencyBulkSignupEmail('mugt7bljh7gr@wanaivideogenerator.com'),
    ).toBe(true);
    expect(isEmergencyBulkSignupEmail('mugtqmun6f5l@imageeditgpt.com')).toBe(
      true,
    );
  });

  it('can be disabled without changing the Redis set', async () => {
    process.env.EMERGENCY_USER_BLOCKLIST_ENABLED = 'false';
    const service = new EmergencyAccessBlockService(redis);
    await expect(
      service.assertAllowed({
        userId: '16591',
        email: 'mue7i8qwa5id@ve0ai.com',
      }),
    ).resolves.toBeUndefined();
    expect(sismember).not.toHaveBeenCalled();
  });
});
