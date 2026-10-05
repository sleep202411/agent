"use client";

import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/src/hooks/use-user";
import { parseCrewMoney, formatCrewMoneyInput } from "@/src/lib/crew-money";
import { crewApi } from "./api";

export interface ApplicationTerms {
  version: number;
  scope: string;
  feeAmount: string;
  currency: "USD" | "CNY";
  feePeriod: "month" | "episode" | "project";
  paymentTerms?: import("@repo/shared/crew").TaskPaymentTerms | null;
  revenueShareBp: number;
  shareBasis: string | null;
  confirmedAt: string | null;
}
export interface TermsPage {
  currentVersion: number;
  items: ApplicationTerms[];
  nextBeforeVersion: number | null;
}
export function useApplicationTerms(id: string) {
  const { user } = useCurrentUser();
  return useQuery({
    queryKey: ["crew-application-terms", id, user?.id],
    enabled: Boolean(id && user),
    retry: false,
    queryFn: ({ signal }) =>
      crewApi.get<TermsPage>(`/applications/${encodeURIComponent(id)}/terms`, {
        signal,
        cache: "no-store",
      }),
  });
}
export function exactMinorUnits(input: string): string | null {
  const value = parseCrewMoney(input);
  return value !== null && BigInt(value) <= 9999999999999999n ? value : null;
}
export const exactMajorUnits = formatCrewMoneyInput;
