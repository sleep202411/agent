import type { z } from "zod";

/**
 * Finds the zod checks that `z.toJSONSchema` silently drops.
 *
 * `z.toJSONSchema({ unrepresentable: "throw" })` refuses a zod TYPE it cannot
 * render — `z.date()`, `z.bigint()`, `z.custom()`. It says nothing about a
 * CHECK: a `.refine()` predicate, a `.trim()` transform, a `.check()` on a
 * property all vanish from the projected document without a word. That is the
 * dangerous direction of drift. A model handed the projection is told a payload
 * is acceptable, sends it, and the executor — parsing with the zod schema the
 * projection came from — refuses it. The model has no way to learn the rule,
 * because the rule was never in the document it was given.
 *
 * This walker is the signal that is otherwise missing. It reports every check
 * the projection cannot carry, so a caller can decide, per check, whether to
 * express the rule in JSON Schema instead or to record why the gap is safe.
 */

/**
 * Checks `z.toJSONSchema` writes into the projected document.
 *
 * Deliberately an allow-list of what has been verified against zod's converter,
 * not a deny-list of known-lossy kinds: a check kind a future zod release adds
 * is reported as unprojectable until someone confirms it survives. The guard
 * fails closed, because the cost of a false alarm is a build that asks a
 * question and the cost of a miss is a contract the model cannot satisfy.
 */
const PROJECTED_CHECK_KINDS: ReadonlySet<string> = new Set([
  "min_length", // -> minLength / minItems
  "max_length", // -> maxLength / maxItems
  "greater_than", // -> minimum / exclusiveMinimum
  "less_than", // -> maximum / exclusiveMaximum
  "multiple_of", // -> multipleOf
  "number_format", // -> type: "integer" and the format's own bounds
  "string_format", // -> format and/or pattern
]);

/** zod types with no sub-schema to descend into. */
const LEAF_TYPES: ReadonlySet<string> = new Set([
  "string",
  "number",
  "boolean",
  "bigint",
  "symbol",
  "date",
  "file",
  "undefined",
  "null",
  "void",
  "any",
  "unknown",
  "never",
  "nan",
  "literal",
  "enum",
  "template_literal",
  "custom",
  "transform",
]);

/** zod types that wrap exactly one inner schema and add no path segment. */
const WRAPPER_TYPES: ReadonlySet<string> = new Set([
  "optional",
  "nullable",
  "default",
  "prefault",
  "catch",
  "readonly",
  "nonoptional",
  "success",
  "promise",
]);

export interface UnprojectableCheck {
  /** Where the check sits, in wire terms, for locating it in the source. */
  path: string;
  /** zod's own name for it: `custom` for `.refine`, `overwrite` for `.trim`. */
  check: string;
  /** The schema instance carrying the check — the identity an ack is keyed by. */
  schema: object;
}

interface ZodDef {
  type: string;
  checks?: unknown;
  [key: string]: unknown;
}

/**
 * Walks `root` and returns every check `z.toJSONSchema` cannot express.
 *
 * Throws on a zod type it does not know how to traverse: silently declining to
 * descend would turn this guard into the very blind spot it exists to remove.
 */
export function findUnprojectableChecks(root: z.ZodType): UnprojectableCheck[] {
  if (zodDef(root) === null) {
    // Reading zod's internals is what makes this possible and what makes it
    // fragile. If the shape ever moves, say so here rather than reporting a
    // clean bill of health for a schema nothing actually inspected.
    throw new Error(
      "Projection fidelity guard could not read the zod internals of the schema it was given. " +
        "Either the value is not a zod schema or zod's internal layout changed — reteach the guard."
    );
  }
  const found: UnprojectableCheck[] = [];
  walk(root, "$", [], found);
  return found;
}

function walk(node: unknown, path: string, ancestors: object[], found: UnprojectableCheck[]): void {
  const def = zodDef(node);
  if (def === null) return;
  const schema = node as object;
  // A schema reachable from itself is a cycle, not a second occurrence.
  if (ancestors.includes(schema)) return;
  const chain = [...ancestors, schema];

  for (const check of asArray(def.checks)) {
    const kind = checkKind(check);
    if (kind !== null && PROJECTED_CHECK_KINDS.has(kind)) continue;
    found.push({ path, check: kind ?? "unrecognized", schema });
  }

  if (LEAF_TYPES.has(def.type)) return;
  if (WRAPPER_TYPES.has(def.type)) {
    walk(def.innerType, path, chain, found);
    return;
  }

  switch (def.type) {
    case "object": {
      for (const [key, property] of Object.entries(asRecord(def.shape))) {
        walk(property, `${path}.${key}`, chain, found);
      }
      walk(def.catchall, `${path}.*`, chain, found);
      return;
    }
    case "array":
      walk(def.element, `${path}[]`, chain, found);
      return;
    case "tuple": {
      asArray(def.items).forEach((item, index) => {
        walk(item, `${path}[${index}]`, chain, found);
      });
      walk(def.rest, `${path}[...]`, chain, found);
      return;
    }
    case "union": {
      const discriminator = typeof def.discriminator === "string" ? def.discriminator : null;
      asArray(def.options).forEach((option, index) => {
        const label = discriminator === null ? null : optionLabel(option, discriminator);
        walk(option, `${path}<${label ?? index}>`, chain, found);
      });
      return;
    }
    case "intersection":
      walk(def.left, `${path}&left`, chain, found);
      walk(def.right, `${path}&right`, chain, found);
      return;
    case "record":
    case "map":
      walk(def.keyType, `${path}{key}`, chain, found);
      walk(def.valueType, `${path}{value}`, chain, found);
      return;
    case "set":
      walk(def.valueType, `${path}{item}`, chain, found);
      return;
    case "pipe":
      walk(def.in, `${path}|in`, chain, found);
      walk(def.out, `${path}|out`, chain, found);
      return;
    case "lazy":
      walk(
        typeof def.getter === "function" ? (def.getter as () => unknown)() : null,
        `${path}()`,
        chain,
        found
      );
      return;
    default:
      throw new Error(
        `Projection fidelity guard cannot traverse the zod type "${def.type}" at ${path}. ` +
          `Teach it how before shipping a projection of this schema — an untraversed branch is an unchecked one.`
      );
  }
}

/**
 * A discriminated union's arm, named by its own discriminator value.
 *
 * Positional names would make the acknowledgement list churn every time an arm
 * is inserted, which is how a list stops being read.
 */
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

function checkKind(check: unknown): string | null {
  if (check === null || typeof check !== "object") return null;
  const internals = (check as { _zod?: unknown })._zod;
  if (internals === null || typeof internals !== "object") return null;
  const def = (internals as { def?: unknown }).def;
  if (def === null || typeof def !== "object") return null;
  const kind = (def as { check?: unknown }).check;
  return typeof kind === "string" ? kind : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
