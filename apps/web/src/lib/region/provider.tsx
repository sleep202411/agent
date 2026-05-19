"use client";

/**
 * RegionProvider — surfaces the per-request country to client components.
 *
 * The root server layout reads the request header (via `next/headers`)
 * and passes the resolved country down through this provider. Client
 * components read it via `useCountry()` and gate features with
 * `useFeature("name")`.
 *
 * Why a context (and not just reading the header again client-side):
 * the header isn't available in the browser, and querying a geoip API
 * client-side would delay first paint. Render-time injection from
 * server is free.
 */

import { createContext, useContext } from "react";
import type { CountryCode } from "./country";
import { hasFeature, type FeatureName } from "./features";

const CountryContext = createContext<CountryCode>("US");

export function RegionProvider({
  country,
  children,
}: {
  country: CountryCode;
  children: React.ReactNode;
}) {
  return <CountryContext.Provider value={country}>{children}</CountryContext.Provider>;
}

export function useCountry(): CountryCode {
  return useContext(CountryContext);
}

export function useFeature(name: FeatureName): boolean {
  const country = useCountry();
  return hasFeature(name, country);
}
