import { adminUiApiPath, parseAdminEnvelope } from "@/lib/admin-api";

export class RevenueRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}
export async function revenueApi<T>(path: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const multipart = body instanceof FormData;
  const response = await fetch(adminUiApiPath(`/api/admin/creator-revenue${path}`), {
    method: body === undefined ? "GET" : "POST",
    signal,
    cache: "no-store",
    headers: body === undefined || multipart ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
  });
  try {
    return await parseAdminEnvelope<T>(response);
  } catch (error) {
    throw new RevenueRequestError(
      error instanceof Error ? error.message : "Request failed",
      response.status
    );
  }
}
export type RevenuePage<T> = { items: T[]; nextCursor: string | null };
export type RevenueCrew = { id: string; name: string };
export type RevenueMember = { id: string; name: string | null; publicId: string; status: string };
export type RevenueContract = { id: string; filename: string; verifiedAt: string };
export type Allocation = {
  currency: "USD" | "CNY";
  amountMinor: string;
  participants: { crewMemberId: string; shareBps: number; amountMinor: string }[];
};
export type RevenueReceipt = {
  id: string;
  title: string;
  revenueReference: string;
  currency: string;
  amountMinor: string;
  postedAt: string;
  postedByAdminId: string;
};
export type RevenueReceiptDetail = RevenueReceipt & {
  incomeDate?: string | null;
  incomeType?: string | null;
  incomeSource?: string | null;
  notes?: string | null;
  contractNumber?: string | null;
  signingParty?: string | null;
  contractExpiresOn?: string | null;
  supportingContracts?: { id: string; filename: string }[];
  crew: { id: string; name: string };
  contract: { id: string; filename: string };
  participants: {
    crewMemberId: string;
    publicId: string;
    shareBps: number;
    amountMinor: string;
    earningId: string | null;
    status: string;
    reversalReason: string | null;
  }[];
};

export function revenueMinorUnits(input: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(input.trim()))
    throw new Error("Enter a positive amount with up to two decimal places.");
  const [whole, fraction = ""] = input.trim().split(".");
  const result = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  if (result <= BigInt(0) || result > BigInt("9223372036854775807"))
    throw new Error("Revenue amount is outside the supported range.");
  return result.toString();
}
export function revenueShareBps(input: string) {
  const bps = Number(revenueMinorUnits(input));
  if (bps > 10000) throw new Error("Each share must be greater than 0% and at most 100%.");
  return bps;
}
export function revenueMoney(amount: string, currency: string) {
  const value = BigInt(amount);
  return `${currency} ${(value / BigInt(100)).toLocaleString("en-US")}.${(value % BigInt(100)).toString().padStart(2, "0")}`;
}
