import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { CertificatesService } from '../certificates/certificates.service';
import { CreateCrewSchema } from './dto';
import { CrewsService } from './crews.service';

const url = process.env.TASK01_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('Native PostgreSQL producer qualification lifecycle', () => {
  let db: PrismaClient;
  let certificates: CertificatesService;
  let crews: CrewsService;
  let userId: string;
  let certificateId: string;
  const chat = {
    openCrewConversation: jest.fn().mockResolvedValue(undefined),
    syncCrewParticipant: jest.fn().mockResolvedValue(undefined),
  };
  const input = CreateCrewSchema.parse({
    name: 'Qualification test',
    description: 'Test',
    logo: 'test.png',
  });
  beforeAll(() => {
    const target = new URL(url!);
    if (
      target.hostname !== '127.0.0.1' ||
      target.port !== '55439' ||
      target.pathname !== '/task01'
    )
      throw new Error('Only isolated 127.0.0.1:55439/task01 is allowed');
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url }),
      transactionOptions: { timeout: 15000 },
    });
    certificates = new CertificatesService(
      db as never,
      {
        resolvePublicUrl: () => 'https://test.invalid/certificate.png',
      } as never,
      {} as never,
    );
    crews = new CrewsService(
      db as never,
      chat as never,
      {} as never,
      {} as never,
    );
  });
  beforeEach(async () => {
    userId = `qualification-${randomUUID()}`;
    const image = await db.mediaAsset.create({
      data: {
        kind: 'image',
        storageProvider: 'external_url',
        externalUrl: `https://test.invalid/certificates/${userId}.png`,
      },
    });
    const certificate = await certificates.createAdmin({
      userId,
      title: 'FizzDragon Certified AI Producer',
      issuer: 'FizzDragon',
      imageAssetId: image.id,
    });
    certificateId = certificate.id;
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  it('requires explicit review, creates persistently, and respects revocation, restoration and deletion', async () => {
    expect(await crews.creationEligibility(userId)).toEqual({
      eligible: false,
    });
    await expect(crews.create(userId, input)).rejects.toMatchObject({
      response: { code: 'CREW_PRODUCER_CERTIFICATION_REQUIRED' },
    });
    await certificates.updateAdmin(certificateId, {
      credentialType: 'fizzdragon_certified_ai_producer',
    });
    expect(await crews.creationEligibility(userId)).toEqual({ eligible: true });
    const created = await crews.create(userId, input);
    expect(
      await db.crew.findUnique({ where: { id: created.id } }),
    ).not.toBeNull();
    await certificates.revokeAdmin(certificateId, 'Qualification revoked');
    await expect(crews.create(userId, input)).rejects.toMatchObject({
      response: { code: 'CREW_PRODUCER_CERTIFICATION_REQUIRED' },
    });
    await certificates.restoreAdmin(certificateId);
    expect(await crews.creationEligibility(userId)).toEqual({ eligible: true });
    await certificates.deleteAdmin(certificateId);
    expect(await crews.creationEligibility(userId)).toEqual({
      eligible: false,
    });
  });
  it('serializes revocation with a creation that already holds the credential lock', async () => {
    await certificates.updateAdmin(certificateId, {
      credentialType: 'fizzdragon_certified_ai_producer',
    });
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: () => void;
    const reachedLock = new Promise<void>((resolve) => {
      locked = resolve;
    });
    chat.openCrewConversation.mockImplementationOnce(() => {
      locked();
      return hold;
    });
    const creating = crews.create(userId, input);
    await reachedLock;
    let revoked = false;
    const revoking = certificates.revokeAdmin(certificateId, null).then(() => {
      revoked = true;
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(revoked).toBe(false);
    } finally {
      release();
    }
    await creating;
    await revoking;
    expect(await crews.creationEligibility(userId)).toEqual({
      eligible: false,
    });
    await expect(crews.create(userId, input)).rejects.toMatchObject({
      response: { code: 'CREW_PRODUCER_CERTIFICATION_REQUIRED' },
    });
  });
});
