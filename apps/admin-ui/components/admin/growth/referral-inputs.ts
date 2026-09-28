import type { RewardItemKind } from "./referrals-types";

const kinds: readonly RewardItemKind[] = [
  "cash",
  "points_compute",
  "points_community",
  "membership_compute",
  "membership_community",
];

/** The API accepts numeric integers; never round a larger stored amount into that contract. */
export function integerInput(
  value: string | number,
  field: string,
  fallback = 0,
  min = 0,
  max = Number.MAX_SAFE_INTEGER
): number {
  const text = String(value).trim();
  if (!text) return fallback;
  const number = Number(text);
  if (!/^-?\d+$/.test(text) || !Number.isSafeInteger(number) || number < min || number > max)
    throw new Error(`${field}: enter a whole number from ${min} to ${max}.`);
  return number;
}

export function commissionBpsInput(value: string): number {
  const text = value.trim() || "0";
  if (!/^\d+(?:\.\d{1,2})?$/.test(text))
    throw new Error("Commission rate: enter a percentage with at most two decimal places.");
  const [whole, fraction = ""] = text.split(".");
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(bps) || bps < 0 || bps > 10000)
    throw new Error("Commission rate: enter a percentage from 0 to 100.");
  return bps;
}

export function parseRewardItems(
  form: FormData,
  field: string
): { kind: RewardItemKind; amountMinor: number; days: number }[] {
  const raw = form.get(field);
  if (typeof raw !== "string" || !raw.trim()) throw new Error(`${field}: reward data is missing.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${field}: reward data is invalid.`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${field}: reward data must be a list.`);
  return parsed.map((item: unknown) => {
    if (
      !item ||
      typeof item !== "object" ||
      !("kind" in item) ||
      !kinds.includes(item.kind as RewardItemKind)
    )
      throw new Error(`${field}: reward kind is invalid.`);
    const value = item as { kind: RewardItemKind; amountMinor?: unknown; days?: unknown };
    const membership = value.kind === "membership_compute" || value.kind === "membership_community";
    const amount = membership ? 0 : value.amountMinor;
    const days = membership ? value.days : 0;
    if (
      (typeof amount !== "number" && typeof amount !== "string") ||
      (typeof days !== "number" && typeof days !== "string")
    )
      throw new Error(`${field}: reward amount or duration is missing.`);
    return {
      kind: value.kind,
      amountMinor: integerInput(amount, `${field} amount`),
      days: integerInput(days, `${field} days`, 0, 0, 3650),
    };
  });
}
