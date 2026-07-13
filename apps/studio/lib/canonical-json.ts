type JsonPrimitive = boolean | number | string | null;
type CanonicalJson = JsonPrimitive | CanonicalJson[] | { [key: string]: CanonicalJson };

/** Deterministic JSON serialization matching the Story Studio server. */
export function canonicalJsonString(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value));
}

function canonicalizeJson(value: unknown, path = "$"): CanonicalJson {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`Non-finite number at ${path}.`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => canonicalizeJson(item, `${path}[${index}]`));
  }
  if (typeof value === "object") {
    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`Non-plain object at ${path}.`);
    }
    const source = value as Record<string, unknown>;
    const result: Record<string, CanonicalJson> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined) throw new TypeError(`Undefined value at ${path}.${key}.`);
      result[key] = canonicalizeJson(source[key], `${path}.${key}`);
    }
    return result;
  }
  throw new TypeError(`Unsupported JSON value at ${path}.`);
}
