import { AdminAuthService } from './admin-auth.service';

describe('Admin sessions require authentication in every environment', () => {
  it('never synthesizes an administrator for a local database', async () => {
    const previous = process.env.ADMIN_DEV_AUTH_BYPASS;
    process.env.ADMIN_DEV_AUTH_BYPASS = 'true';
    try {
      const service = new AdminAuthService({} as never);
      await expect(service.validateSession(undefined)).rejects.toMatchObject({
        response: { code: 'ADMIN_AUTH_REQUIRED' },
      });
    } finally {
      if (previous === undefined) delete process.env.ADMIN_DEV_AUTH_BYPASS;
      else process.env.ADMIN_DEV_AUTH_BYPASS = previous;
    }
  });
});
