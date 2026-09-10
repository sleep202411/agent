/**
 * Historically covered Nest `user_certificates` producer-cert locking for
 * crew create. That gate was replaced by Java `user_level.id = 13`
 * (`hasCrewCreatePass`) — see `user-level-gates.ts` and `CrewsService.create`.
 *
 * Kept as an explicit skip so the suite name remains searchable if someone
 * greps for the old producer-certification lifecycle.
 */
describe.skip('Native PostgreSQL producer qualification lifecycle (superseded by Java level 13)', () => {
  it('placeholder', () => {
    expect(true).toBe(true);
  });
});
