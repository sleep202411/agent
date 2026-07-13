import { createHash } from 'node:crypto';

type JsonPrimitive = boolean | number | string | null;
export type CanonicalJson =
  | JsonPrimitive
  | CanonicalJson[]
  | { [key: string]: CanonicalJson };

/**
 * Convert an arbitrary JSON-compatible value into a deterministic structure.
 * Object keys are sorted recursively; array order is semantic and preserved.
 * Undefined, functions, symbols, non-finite numbers and bigint are rejected so
 * hashes can never depend on JSON.stringify's silent data loss.
 */
export function canonicalizeJson(value: unknown, path = '$'): CanonicalJson {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Non-finite number at ${path}.`);
    }
    return Object.is(value, -0) ? 0 : value;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) =>
      canonicalizeJson(item, `${path}[${index}]`),
    );
  }

  if (typeof value === 'object') {
    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`Non-plain object at ${path}.`);
    }

    const source = value as Record<string, unknown>;
    const result: Record<string, CanonicalJson> = {};
    for (const key of Object.keys(source).sort()) {
      const item = source[key];
      if (item === undefined) {
        throw new TypeError(`Undefined value at ${path}.${key}.`);
      }
      result[key] = canonicalizeJson(item, `${path}.${key}`);
    }
    return result;
  }

  throw new TypeError(`Unsupported JSON value at ${path}.`);
}

export function canonicalJsonString(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value));
}

export function canonicalJsonHash(value: unknown): string {
  return createHash('sha256').update(canonicalJsonString(value)).digest('hex');
}
