import { CURRENT_CELL } from "@/src/lib/region/cell";
export type CrewLedgerCurrency = "POINTS" | "CNY" | "USD";
export const CREW_CURRENCY: "CNY" | "USD" = CURRENT_CELL === "cn" ? "CNY" : "USD";
export function formatCrewMoney(
  value: string,
  locale: string,
  currency: CrewLedgerCurrency
): string {
  const amount = BigInt(value);
  if (currency === "POINTS") return amount.toLocaleString(locale);
  const absolute = amount < 0n ? -amount : amount;
  return `${currency} ${amount < 0n ? "-" : ""}${(absolute / 100n).toLocaleString(locale)}.${(absolute % 100n).toString().padStart(2, "0")}`;
}
