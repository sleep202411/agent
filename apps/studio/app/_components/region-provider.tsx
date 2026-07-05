"use client";

import { createContext, useContext } from "react";

export type SiteRegion = "global" | "cn";

const CountryContext = createContext("US");
// The deployment cell (NOT the user's country / currency / UI language). Read from
// runtime pod env by the server layout — studio bakes no NEXT_PUBLIC_*, so client
// code cannot read it directly; it must flow through this provider.
const SiteRegionContext = createContext<SiteRegion>("global");

export function RegionProvider({
  country,
  siteRegion,
  children,
}: {
  country: string;
  siteRegion: SiteRegion;
  children: React.ReactNode;
}) {
  return (
    <SiteRegionContext.Provider value={siteRegion}>
      <CountryContext.Provider value={country}>{children}</CountryContext.Provider>
    </SiteRegionContext.Provider>
  );
}

export function useCountry() {
  return useContext(CountryContext);
}

export function useSiteRegion() {
  return useContext(SiteRegionContext);
}

/** True on the .cn deployment — the signal for CN-only commerce behaviour. */
export function useIsCnSite() {
  return useSiteRegion() === "cn";
}
