import { randomUUID } from 'node:crypto';
import {
  ContentGpsLocationsController,
  ContentGpsLocationsService,
  SaveOwnerLocationsSchema,
} from './content-gps-locations';
import type { AuthUser } from '../auth';
const location = {
  id: randomUUID(),
  kind: 'story_setting',
  label: 'Atlantis',
  status: 'fictional',
  point: null,
};
const valid = () => ({
  requestId: randomUUID(),
  expectedVersion: 0,
  locations: [location],
});
describe('owner GPS input', () => {
  it('accepts unknown/fictional places without fabricating a point', () => {
    expect(
      SaveOwnerLocationsSchema.parse(valid()).locations[0].point,
    ).toBeNull();
  });
  it.each([
    { ...location, point: { latitude: 0, longitude: 0 } },
    { ...location, status: 'resolved', point: null },
    { ...location, kind: 'creator_physical_location' },
    { ...location, review: { status: 'confirmed' } },
  ])('rejects unsupported or contradictory location data %j', (bad) => {
    expect(
      SaveOwnerLocationsSchema.safeParse({ ...valid(), locations: [bad] })
        .success,
    ).toBe(false);
  });
  it('rejects duplicate IDs, unbounded input, and forged actor/AI provenance', () => {
    for (const payload of [
      { ...valid(), locations: [location, location] },
      {
        ...valid(),
        locations: Array.from({ length: 101 }, () => ({
          ...location,
          id: randomUUID(),
        })),
      },
      { ...valid(), updatedById: 'another-owner' },
      { ...valid(), expectedVersion: -1 },
    ])
      expect(SaveOwnerLocationsSchema.safeParse(payload).success).toBe(false);
  });
  it('accepts real (0,0) only with explicit coordinate system and precision', () => {
    const point = {
      latitude: 0,
      longitude: 0,
      coordinateSystem: 'WGS84',
      precision: 'place',
    };
    const payload = {
      ...valid(),
      locations: [{ ...location, status: 'resolved', point }],
    };
    expect(SaveOwnerLocationsSchema.safeParse(payload).success).toBe(true);
    expect(
      SaveOwnerLocationsSchema.safeParse({
        ...payload,
        locations: [
          {
            ...payload.locations[0],
            point: { ...point, provider: 'pretend-geocoder' },
          },
        ],
      }).success,
    ).toBe(false);
  });
});
describe('owner GPS controller', () => {
  it('uses the normal envelope and propagates owner denial', async () => {
    const read = jest.fn().mockResolvedValue({ version: 0, locations: null });
    const save = jest.fn().mockResolvedValue({ version: 1 });
    const controller = new ContentGpsLocationsController({
      read,
      save,
    } as unknown as ContentGpsLocationsService);
    const user = { userId: 'owner' } as AuthUser;
    const params = { ipId: randomUUID() };
    const input = SaveOwnerLocationsSchema.parse(valid());
    expect(await controller.read(params, user)).toEqual({
      code: 200,
      data: { version: 0, locations: null },
    });
    expect(await controller.save(params, user, input)).toEqual({
      code: 200,
      data: { version: 1 },
    });
    expect(save).toHaveBeenCalledWith(params.ipId, user, input);
    read.mockRejectedValueOnce(new Error('IP not found.'));
    await expect(controller.read(params, user)).rejects.toThrow(
      'IP not found.',
    );
  });
});
