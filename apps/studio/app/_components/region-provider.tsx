"use client";

import { createContext, useContext } from "react";

const CountryContext = createContext("US");

export function RegionProvider({
  country,
  children,
}: {
  country: string;
  children: React.ReactNode;
}) {
  return <CountryContext.Provider value={country}>{children}</CountryContext.Provider>;
}

export function useCountry() {
  return useContext(CountryContext);
}
