import {
  allowedCurrencies,
  assertAllowedCurrency,
  defaultCurrency,
} from './currency';
jest.mock('./region', () => ({ CURRENT_CELL: 'com' }));
test('international new amounts allow USD only', () => {
  expect(allowedCurrencies()).toEqual(['USD']);
  expect(defaultCurrency()).toBe('USD');
  expect(() => assertAllowedCurrency('USD', 'currency')).not.toThrow();
  for (const currency of ['CNY', 'EUR', 'SGD', 'JPY'])
    expect(() => assertAllowedCurrency(currency, 'currency')).toThrow();
});
