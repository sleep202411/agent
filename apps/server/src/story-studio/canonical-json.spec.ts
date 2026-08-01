import {
  canonicalizeJson,
  canonicalJsonHash,
  canonicalJsonString,
} from './canonical-json';
import { runInNewContext } from 'node:vm';

describe('canonical JSON', () => {
  it('sorts object keys recursively while preserving array order', () => {
    expect(
      canonicalJsonString({
        z: 1,
        nested: { b: true, a: 'first' },
        list: [2, 1],
      }),
    ).toBe('{"list":[2,1],"nested":{"a":"first","b":true},"z":1}');
  });

  it('produces the same hash for semantically identical key orderings', () => {
    expect(canonicalJsonHash({ b: 2, a: { y: 1, x: 0 } })).toBe(
      canonicalJsonHash({ a: { x: 0, y: 1 }, b: 2 }),
    );
  });

  it('normalizes negative zero', () => {
    expect(canonicalizeJson({ value: -0 })).toEqual({ value: 0 });
  });

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, 1n])(
    'rejects unsupported value %p',
    (value) => {
      expect(() => canonicalizeJson({ value })).toThrow(TypeError);
    },
  );

  it('accepts plain JSON objects created in another JavaScript realm', () => {
    const crossRealm: unknown = runInNewContext(
      '({ nested: { value: 1 }, list: [true, null] })',
    );

    expect(canonicalJsonString(crossRealm)).toBe(
      '{"list":[true,null],"nested":{"value":1}}',
    );
  });

  it.each([
    new Date('2026-01-01T00:00:00.000Z'),
    new Map([['value', 1]]),
    new (class DomainObject {
      value = 1;
    })(),
    Object.assign(Object.create({ inherited: true }), { value: 1 }),
  ])('rejects non-JSON object prototypes', (value) => {
    expect(() => canonicalizeJson(value)).toThrow('Non-plain object');
  });
});
