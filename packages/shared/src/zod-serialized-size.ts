import { z } from "zod";

/**
 * Worst-case serialized size of a zod schema, and the UTF-8 primitives that
 * make a byte budget expressible in the first place.
 *
 * A transport with a hard per-message ceiling needs an answer to one question
 * before a field ships, not after: *how large can this get?* zod answers a
 * different question — is this value legal — and the two diverge precisely
 * where it hurts. `z.string().max(64_000)` is a bound on UTF-16 code units. In
 * CJK it admits ~187 KiB of UTF-8. A schema author reading `64_000` next to a
 * "64 KiB limit" concludes, reasonably and wrongly, that the field fits.
 *
 * So the unit is bytes, always, and the walker below refuses to guess: a field
 * with no bound is reported as unbounded rather than assigned a default. A
 * budget that silently tolerates one unbounded field is not a budget.
 */

/**
 * Registry key carrying an exact UTF-8 byte ceiling on a string.
 *
 * `.max()` counts code units and cannot express "8 KiB of any script". The
 * bound is enforced by a refinement (invisible to any static reader) so the
 * ceiling is also recorded as metadata, where {@link measureMaxSerializedBytes}
 * can find it. Use {@link utf8BoundedString} rather than writing both halves by
 * hand — a refinement without the metadata measures as its code-unit bound,
 * which is the mistake this module exists to prevent.
 */
export const UTF8_BYTE_BOUND_META_KEY = "maxUtf8Bytes";

/**
 * Default cost of one UTF-16 code unit, in serialized bytes.
 *
 * Three is the true maximum for text: a BMP character is at most 3 UTF-8 bytes
 * and one code unit; an astral character is 4 bytes across two code units, so 2
 * per unit. Four is deliberately one over, to absorb the JSON escapes that do
 * cost more than the character they replace (`\"` and `\n` cost 2). The one
 * input that beats 4 is a run of exotic C0 controls, which escape to six bytes
 * each — U+0007 serializes as six characters, `\` `u` `0` `0` `0` `7`. That is
 * not text, and the headroom between a budget and the transport's real ceiling
 * is what covers it. State that headroom explicitly wherever a budget is set.
 */
export const DEFAULT_BYTES_PER_CHARACTER = 4;

/**
 * Serialized width of a JSON number.
 *
 * The longest a double can print is `-1.7976931348623157e+308` — 24 bytes.
 * Bounded integers are narrower, but a number is never the field that breaks a
 * budget, so the schema-independent maximum is used rather than deriving one
 * from `.int().max()`.
 */
const NUMBER_BYTES = 24;

/**
 * Fixed-width string formats, in code units.
 *
 * Only formats whose grammar pins a length are listed. `url` and `email` are
 * absent on purpose: they are formats, not bounds, and a schema that relies on
 * one to stay small is relying on nothing.
 */
const STRING_FORMAT_MAX_CHARACTERS: ReadonlyMap<string, number> = new Map([
  ["uuid", 36],
  ["guid", 36],
  ["uuidv4", 36],
  ["uuidv6", 36],
  ["uuidv7", 36],
  ["nanoid", 21],
  ["date", 10],
]);

/** A place the walker could not put a ceiling on. */
export interface UnboundedValue {
  /** Wire path, for locating the field in the schema source. */
  path: string;
  /** Why no ceiling exists, phrased as the thing to fix. */
  reason: string;
}

export interface SerializedSizeReport {
  /**
   * Worst-case serialized bytes of everything that *is* bounded.
   *
   * Meaningful only when `unbounded` is empty — an unbounded field contributes
   * nothing here, so a report with findings understates the true size by an
   * unknown amount. Never compare this against a budget without checking
   * `unbounded` first; {@link assertMaxSerializedBytes} does both.
   */
  bytes: number;
  unbounded: UnboundedValue[];
}

export interface MeasureOptions {
  /** Serialized bytes charged per UTF-16 code unit of a bounded string. */
  bytesPerCharacter?: number;
}

/** UTF-8 length of a string, without allocating an encoded copy. */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        // A lone surrogate is encoded as U+FFFD, which is three bytes.
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/**
 * A string bounded in UTF-8 bytes rather than code units.
 *
 * Carries three things, and needs all three: the byte refinement that actually
 * enforces the ceiling, a code-unit `.max()` at the same number (never tighter
 * than the byte rule, since every character costs at least one byte, and it
 * gives static readers and JSON Schema projections a visible bound), and the
 * metadata {@link measureMaxSerializedBytes} reads. `.meta()` must stay last:
 * it registers the instance it returns, and any further chaining would produce
 * an unregistered clone that measures by code units again.
 */
export function utf8BoundedString(
  maxBytes: number,
  options: { minCharacters?: number } = {}
): z.ZodType<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error(`A UTF-8 byte bound must be a positive integer, received ${maxBytes}.`);
  }
  const minCharacters = options.minCharacters ?? 0;
  const base = minCharacters > 0 ? z.string().min(minCharacters) : z.string();
  return base
    .max(maxBytes)
    .refine((value) => utf8ByteLength(value) <= maxBytes, {
      error: `Must not exceed ${maxBytes} UTF-8 bytes.`,
    })
    .meta({ [UTF8_BYTE_BOUND_META_KEY]: maxBytes });
}

/**
 * Worst-case serialized bytes of `schema`, plus every place it has no ceiling.
 *
 * Throws on a zod type it has not been taught to traverse. Declining to descend
 * would let a new construct pass the budget gate unmeasured, which is the exact
 * failure the gate exists to prevent.
 */
export function measureMaxSerializedBytes(
  schema: z.ZodType,
  options: MeasureOptions = {}
): SerializedSizeReport {
  const bytesPerCharacter = options.bytesPerCharacter ?? DEFAULT_BYTES_PER_CHARACTER;
  const unbounded: UnboundedValue[] = [];
  const bytes = measure(schema, "$", [], unbounded, bytesPerCharacter);
  return { bytes, unbounded };
}

/**
 * Measures `schema` and throws unless it fits `maxBytes` with no unbounded
 * field. The message names every offender, because a gate that reports one
 * problem per run is a gate nobody finishes fixing.
 */
export function assertMaxSerializedBytes(
  schema: z.ZodType,
  maxBytes: number,
  label: string,
  options: MeasureOptions = {}
): void {
  const report = measureMaxSerializedBytes(schema, options);
  if (report.unbounded.length > 0) {
    const findings = report.unbounded.map((item) => `  ${item.path}: ${item.reason}`).join("\n");
    throw new Error(`${label} has values with no size ceiling:\n${findings}`);
  }
  if (report.bytes > maxBytes) {
    throw new Error(
      `${label} serializes to at most ${report.bytes} bytes, over the ${maxBytes}-byte budget.`
    );
  }
}

interface ZodDef {
  type: string;
  checks?: unknown;
  format?: unknown;
  [key: string]: unknown;
}

function measure(
  node: unknown,
  path: string,
  ancestors: object[],
  unbounded: UnboundedValue[],
  bytesPerCharacter: number
): number {
  const def = zodDef(node);
  if (def === null) {
    throw new Error(
      `Serialized-size guard was handed a non-schema at ${path}. Either the value is not a zod ` +
        `schema or zod's internal layout changed — reteach the guard rather than trusting it.`
    );
  }
  const schema = node as object;
  if (ancestors.includes(schema)) {
    // A schema reachable from itself nests arbitrarily deep. There is no
    // worst case, and pretending otherwise would report a finite number for an
    // infinite structure.
    unbounded.push({
      path,
      reason: "recursive schema — nesting depth is unbounded, so its size is too",
    });
    return 0;
  }
  const chain = [...ancestors, schema];
  const recurse = (child: unknown, childPath: string): number =>
    measure(child, childPath, chain, unbounded, bytesPerCharacter);

  switch (def.type) {
    case "string":
      return measureString(def, path, unbounded, bytesPerCharacter, schema);
    case "number":
    case "int":
      return NUMBER_BYTES;
    case "boolean":
      return "false".length;
    case "null":
      return "null".length;
    case "undefined":
    case "void":
      // Absent from the serialized document; the containing object charges the
      // key regardless, which keeps the estimate conservative.
      return 0;
    case "literal": {
      const values = asArray(def.values);
      return Math.max(0, ...values.map((value) => utf8ByteLength(JSON.stringify(value) ?? "null")));
    }
    case "enum": {
      const entries = Object.values(asRecord(def.entries));
      return Math.max(
        0,
        ...entries.map((value) => utf8ByteLength(JSON.stringify(value) ?? "null"))
      );
    }
    case "optional":
    case "nullable":
    case "nonoptional":
    case "readonly":
    case "default":
    case "prefault":
    case "catch":
      return Math.max(recurse(def.innerType, path), "null".length);
    case "object": {
      const shape = asRecord(def.shape);
      const catchall = zodDef(def.catchall);
      if (catchall !== null && catchall.type !== "never") {
        unbounded.push({
          path: `${path}.*`,
          reason: "open object — an unknown number of extra keys may be serialized",
        });
      }
      const entries = Object.entries(shape);
      const body = entries.reduce((total, [key, property]) => {
        const keyBytes = utf8ByteLength(JSON.stringify(key));
        return total + keyBytes + 1 + recurse(property, `${path}.${key}`);
      }, 0);
      const separators = Math.max(0, entries.length - 1);
      return 2 + body + separators;
    }
    case "array": {
      const max = maxLength(def);
      const element = recurse(def.element, `${path}[]`);
      if (max === null) {
        unbounded.push({
          path,
          reason: "array with no .max() — element count is unbounded",
        });
        return 2;
      }
      return 2 + max * element + Math.max(0, max - 1);
    }
    case "tuple": {
      const items = asArray(def.items);
      const body = items.reduce<number>(
        (total, item, index) => total + recurse(item, `${path}[${index}]`),
        0
      );
      if (def.rest !== null && def.rest !== undefined) {
        unbounded.push({ path, reason: "tuple with a rest element — length is unbounded" });
      }
      return 2 + body + Math.max(0, items.length - 1);
    }
    case "union": {
      const discriminator = typeof def.discriminator === "string" ? def.discriminator : null;
      const options = asArray(def.options);
      return Math.max(
        0,
        ...options.map((option, index) => {
          const label = discriminator === null ? null : optionLabel(option, discriminator);
          return recurse(option, `${path}<${label ?? index}>`);
        })
      );
    }
    case "intersection":
      return recurse(def.left, `${path}&left`) + recurse(def.right, `${path}&right`);
    case "record":
    case "map":
      unbounded.push({ path, reason: "record/map — the number of keys is unbounded" });
      return 2;
    case "set":
      unbounded.push({ path, reason: "set — the number of members is unbounded" });
      return 2;
    case "lazy":
      return recurse(
        typeof def.getter === "function" ? (def.getter as () => unknown)() : null,
        `${path}()`
      );
    case "pipe":
      // What crosses the wire is the pipe's output.
      return recurse(def.out, path);
    case "any":
    case "unknown":
      unbounded.push({ path, reason: "any/unknown — no shape to bound" });
      return 0;
    case "never":
      return 0;
    default:
      throw new Error(
        `Serialized-size guard cannot measure the zod type "${def.type}" at ${path}. ` +
          `Teach it before putting this schema on a bounded transport.`
      );
  }
}

function measureString(
  def: ZodDef,
  path: string,
  unbounded: UnboundedValue[],
  bytesPerCharacter: number,
  schema: object
): number {
  const quotes = 2;
  const byteBound = utf8ByteBound(schema);
  if (byteBound !== null) {
    return quotes + byteBound;
  }
  const max = maxLength(def);
  if (max !== null) {
    return quotes + max * bytesPerCharacter;
  }
  const format = typeof def.format === "string" ? def.format : null;
  const precision = def.precision;
  const fixedTimeLength =
    (format === "time" || format === "datetime") &&
    typeof precision === "number" &&
    Number.isSafeInteger(precision) &&
    precision >= -1
      ? precision === -1
        ? 5
        : precision === 0
          ? 8
          : 9 + precision
      : undefined;
  // Default ISO time/datetime permits arbitrary fractional precision; durations
  // also permit arbitrary digit counts. Only explicit precision pins a width.
  const formatMax =
    fixedTimeLength !== undefined
      ? fixedTimeLength + (format === "datetime" ? 11 + (def.offset ? 6 : 1) : 0)
      : format === null
        ? undefined
        : STRING_FORMAT_MAX_CHARACTERS.get(format);
  if (formatMax !== undefined) {
    return quotes + formatMax * bytesPerCharacter;
  }
  unbounded.push({
    path,
    reason:
      format === null
        ? "string with no .max() and no fixed-width format"
        : `string whose only bound is the "${format}" format, which does not pin a length`,
  });
  return quotes;
}

function utf8ByteBound(schema: object): number | null {
  const meta = z.globalRegistry.get(schema as never) as Record<string, unknown> | undefined;
  const bound = meta?.[UTF8_BYTE_BOUND_META_KEY];
  return typeof bound === "number" && Number.isFinite(bound) ? bound : null;
}

/**
 * The tightest length ceiling on a string or array.
 *
 * `.length(n)` is a distinct check from `.max(n)` — zod records it as
 * `length_equals` — and missing it would report a fixed-width field as
 * unbounded, which is the kind of false alarm that gets a guard disabled.
 */
function maxLength(def: ZodDef): number | null {
  let found: number | null = null;
  const consider = (value: unknown): void => {
    if (typeof value !== "number") return;
    found = found === null ? value : Math.min(found, value);
  };
  for (const check of asArray(def.checks)) {
    const checkDef = checkInternals(check);
    if (checkDef === null) continue;
    if (checkDef.check === "max_length") consider(checkDef.maximum);
    if (checkDef.check === "length_equals") consider(checkDef.length);
  }
  return found;
}

function optionLabel(option: unknown, discriminator: string): string | null {
  const def = zodDef(option);
  if (def === null) return null;
  const field = asRecord(def.shape)[discriminator];
  const fieldDef = zodDef(field);
  if (fieldDef === null) return null;
  const values = asArray(fieldDef.values);
  return values.length === 1 ? String(values[0]) : null;
}

function zodDef(node: unknown): ZodDef | null {
  if (node === null || typeof node !== "object") return null;
  const internals = (node as { _zod?: unknown })._zod;
  if (internals === null || typeof internals !== "object") return null;
  const def = (internals as { def?: unknown }).def;
  if (def === null || typeof def !== "object") return null;
  const type = (def as { type?: unknown }).type;
  return typeof type === "string" ? (def as ZodDef) : null;
}

function checkInternals(check: unknown): Record<string, unknown> | null {
  if (check === null || typeof check !== "object") return null;
  const internals = (check as { _zod?: unknown })._zod;
  if (internals === null || typeof internals !== "object") return null;
  const def = (internals as { def?: unknown }).def;
  return def !== null && typeof def === "object" ? (def as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
