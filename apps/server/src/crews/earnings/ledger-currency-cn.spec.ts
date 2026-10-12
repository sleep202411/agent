import { crewCurrency, assertNewCrewCurrency } from './ledger-currency';
jest.mock('../../common/region', () => ({ CURRENT_CELL: 'cn' }));
test('CN monetary defaults and write validation use CNY independently of language', () => {
  expect(crewCurrency()).toBe('CNY');
  expect(() => assertNewCrewCurrency('CNY')).not.toThrow();
  expect(() => assertNewCrewCurrency('USD')).not.toThrow();
});
