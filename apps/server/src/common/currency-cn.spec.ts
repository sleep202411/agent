import {
  allowedCurrencies,
  assertAllowedCurrency,
  defaultCurrency,
} from './currency';
jest.mock('./region', () => ({ CURRENT_CELL: 'cn' }));
test('domestic new amounts allow CNY only', () => {
  expect(allowedCurrencies()).toEqual(['CNY']);
  expect(defaultCurrency()).toBe('CNY');
  expect(() => assertAllowedCurrency('CNY', 'currency')).not.toThrow();
  expect(() => assertAllowedCurrency('USD', 'currency')).toThrow();
});
