/**
 * Typed stand-ins for jest's asymmetric matchers, plus the call shape of the
 * raw-SQL mocks these suites read back.
 *
 * `@types/jest` declares every asymmetric matcher as `any`. Embedding one
 * directly in an expected object poisons the whole literal: the compiler stops
 * checking its siblings, so a renamed or misspelled key becomes an assertion
 * about nothing and the suite keeps passing. That is the same failure mode
 * these suites exist to catch, one level up.
 *
 * Each wrapper widens jest's `any` to `unknown` exactly once. Widening asserts
 * nothing — every value really is assignable to `unknown` — so none of these
 * can be wrong, and every call site keeps a fully checked expected object.
 */

/** `expect.any(String)`. */
export function anyString(): unknown {
  return expect.any(String) as unknown;
}

/** `expect.any(Date)`. */
export function anyDate(): unknown {
  return expect.any(Date) as unknown;
}

/** `expect.any(Function)`. */
export function anyFunction(): unknown {
  return expect.any(Function) as unknown;
}

/** `expect.anything()`. */
export function anything(): unknown {
  return expect.anything() as unknown;
}

/** `expect.stringContaining(text)`. */
export function stringContaining(text: string): unknown {
  return expect.stringContaining(text) as unknown;
}

/** `expect.stringMatching(pattern)`. */
export function stringMatching(pattern: RegExp | string): unknown {
  return expect.stringMatching(pattern) as unknown;
}

/** `expect.objectContaining(shape)`. */
export function objectContaining(shape: Record<string, unknown>): unknown {
  return expect.objectContaining(shape) as unknown;
}

/** `expect.arrayContaining(items)`. */
export function arrayContaining(items: readonly unknown[]): unknown {
  return expect.arrayContaining([...items]) as unknown;
}

/**
 * The call shape of Prisma's tagged-template raw-SQL methods: the template
 * fragments first, then one bound parameter per interpolation. Declaring it on
 * the mock is what lets a suite read `mock.calls[n][0]` as the fragment array
 * it is, instead of an `any` that would accept `.join` on anything at all.
 */
export type RawSqlCall = [TemplateStringsArray, ...unknown[]];
