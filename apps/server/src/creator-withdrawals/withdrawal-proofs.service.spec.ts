import { WithdrawalProofsService } from './withdrawal-proofs.service';
import { PrismaService } from '../infra/db/db.module';
import { StorageProviderRegistry } from '../infra/storage/storage-provider-registry.service';
import { WithdrawalAdminService } from './withdrawal-admin.service';
import type { AdminActor } from '../admin-auth';

describe('Withdrawal proof recovery', () => {
  const admin = { id: 'finance' } as AdminActor;
  function fixture(attached = false) {
    const tx = {
      creatorWithdrawal: {
        findUnique: jest.fn().mockResolvedValue({ userId: 'creator' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          paymentProofId: attached ? 'proof' : null,
          status: 'processing',
          processingAdminId: 'finance',
        }),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: 'proof',
          due: true,
          provider: 's3_compatible',
          bucket: 'private',
          object_key: 'key',
          region: null,
        },
      ]),
    };
    const db = {
      $queryRaw: jest.fn().mockResolvedValue([{ withdrawal_id: 'withdrawal' }]),
      $executeRaw: jest.fn(),
      $transaction: jest.fn((fn: (client: typeof tx) => unknown) =>
        Promise.resolve(fn(tx)),
      ),
    };
    const storage = { deleteObject: jest.fn().mockResolvedValue(undefined) };
    const access = { assertAccess: jest.fn() };
    const service = new WithdrawalProofsService(
      db as unknown as PrismaService,
      { forProvider: () => storage } as unknown as StorageProviderRegistry,
      access as unknown as WithdrawalAdminService,
    );
    return { service, db, tx, storage, access };
  }
  it('never deletes attached paid evidence', async () => {
    const { service, storage, db } = fixture(true);
    await service.cleanup('proof');
    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
  it('retires abandoned evidence before physical deletion', async () => {
    const { service, storage, tx, db } = fixture();
    await service.cleanup('proof');
    expect(
      (
        tx.$executeRaw.mock.calls as [TemplateStringsArray, ...unknown[]][]
      )[1][0].join(''),
    ).toContain("status='retired'");
    expect(tx.$executeRaw.mock.invocationCallOrder[1]).toBeLessThan(
      storage.deleteObject.mock.invocationCallOrder[0],
    );
    expect(storage.deleteObject).toHaveBeenCalledWith({
      bucket: 'private',
      storageKey: 'key',
      region: null,
    });
    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
  });
  it('keeps the recovery row when physical deletion fails', async () => {
    const { service, storage, db } = fixture();
    storage.deleteObject.mockRejectedValue(new Error('offline'));
    await expect(service.cleanup('proof')).rejects.toThrow('offline');
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
  it('checks finance access before inspecting bytes or writing storage', async () => {
    const { service, access, db } = fixture();
    access.assertAccess.mockImplementation(() => {
      throw new Error('forbidden');
    });
    await expect(service.upload(admin, 'withdrawal')).rejects.toThrow(
      'forbidden',
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('rejects invalid file bytes before allocating private storage', async () => {
    const { service, db } = fixture();
    await expect(
      service.upload(admin, 'withdrawal', {
        buffer: Buffer.from('fake.pdf'),
        originalname: 'fake.pdf',
      }),
    ).rejects.toThrow('payment proof up to 10 MB');
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
