export function describeUnknown(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return `${value}`;
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol') {
    return value.description ? `Symbol(${value.description})` : 'Symbol()';
  }
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  try {
    const json = JSON.stringify(value);
    if (typeof json === 'string') return json;
  } catch {
    // Fall through to a stable non-leaking object placeholder below.
  }
  return '[unserializable object]';
}

export function scalarString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return `${value}`;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'bigint') return value.toString();
  return undefined;
}

export function requiredScalarString(value: unknown): string {
  return scalarString(value) ?? '';
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
