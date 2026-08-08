/**
 * Fractional index keys — the ordering primitive for collaborative lists.
 *
 * Keys are base-62 fractions over an ASCII-ascending alphabet, so plain string
 * comparison IS the sort. A key never ends in the smallest digit, which is what
 * guarantees a midpoint always exists between two neighbours — inserting or
 * reordering writes ONE key and renumbers nothing.
 *
 * This lives in shared because BOTH sides mint keys: the browser when a human
 * inserts or drags a row, and the server when an agent authors one. Two
 * implementations of this algorithm is a correctness bug, not a duplication
 * smell — a key one side mints must be a key the other side accepts, or rows
 * sort into positions nobody asked for.
 *
 * (Unrelated to `order.ts`, which is the service-transaction order.)
 */

/** Base-62, ASCII-ascending: string comparison is numeric comparison. */
export const ORDER_DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const ORDER_BASE = ORDER_DIGITS.length;
/** Sorts after every real key, so an order-less item lands at the end. */
export const ORDER_LAST = "\uffff";

function midpoint(lower: string, upper: string | null): string {
  if (upper !== null && lower >= upper) throw new Error(`order key out of range: ${lower}`);
  if (lower.endsWith(ORDER_DIGITS[0]) || upper?.endsWith(ORDER_DIGITS[0])) {
    throw new Error("order key has a trailing zero");
  }
  if (upper !== null) {
    // Copy the shared prefix verbatim and recurse on the remainder (`lower` is
    // padded with zeros as we go; `upper` can't run out first, being larger).
    let shared = 0;
    while ((lower[shared] ?? ORDER_DIGITS[0]) === upper[shared]) shared += 1;
    if (shared > 0) {
      return upper.slice(0, shared) + midpoint(lower.slice(shared), upper.slice(shared));
    }
  }
  const lowerDigit = lower ? ORDER_DIGITS.indexOf(lower[0]) : 0;
  const upperDigit = upper !== null ? ORDER_DIGITS.indexOf(upper[0]) : ORDER_BASE;
  if (upperDigit - lowerDigit > 1) {
    return ORDER_DIGITS[Math.round(0.5 * (lowerDigit + upperDigit))];
  }
  // Consecutive first digits: borrow a digit and split the level below.
  if (upper !== null && upper.length > 1) return upper.slice(0, 1);
  return ORDER_DIGITS[lowerDigit] + midpoint(lower.slice(1), null);
}

/**
 * Whether a value is a well-formed key. A trailing smallest-digit is rejected
 * because it leaves no room below it — that is the invariant `midpoint` relies
 * on, so a key that violates it poisons every later insert against it.
 */
export function isOrderKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.endsWith(ORDER_DIGITS[0]) &&
    [...value].every((char) => ORDER_DIGITS.includes(char))
  );
}

/**
 * A key strictly between two neighbours (null = start / end of the list).
 * Degenerate input (equal or inverted neighbours, a foreign key from an older
 * client) appends after `lower` instead of throwing — an ordered list must
 * never lose a row to a bad sort key.
 */
export function orderBetween(
  lower: string | null | undefined,
  upper: string | null | undefined
): string {
  const before = isOrderKey(lower) ? lower : null;
  const after = isOrderKey(upper) ? upper : null;
  try {
    return midpoint(before ?? "", after);
  } catch {
    return midpoint(before ?? "", null);
  }
}

/** The key for an item appended after `last` (null = the list is empty). */
export function orderAfter(last: string | null | undefined): string {
  return orderBetween(last, null);
}
