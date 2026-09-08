import { CURRENT_CELL } from "@/src/lib/region/cell";
export type CrewLedgerCurrency = "CNY" | "USD";
export const CREW_CURRENCY: "CNY" | "USD" = CURRENT_CELL === "cn" ? "CNY" : "USD";
export function formatCrewMoney(
  value: string,
  locale: string,
  currency: CrewLedgerCurrency
): string {
  const amount = BigInt(value);
  const absolute = amount < 0n ? -amount : amount;
  return `${currency} ${amount < 0n ? "-" : ""}${(absolute / 100n).toLocaleString(locale)}.${(absolute % 100n).toString().padStart(2, "0")}`;
}

/** Display amount to integer cents/fen, without rounding or precision loss. */
export function parseCrewMoney(value: string): string | null {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const amount = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
  return amount <= 9_223_372_036_854_775_807n ? amount.toString() : null;
}

export function formatCrewMoneyInput(value: string): string {
  const amount = BigInt(value);
  return `${amount / 100n}.${(amount % 100n).toString().padStart(2, "0")}`;
}
