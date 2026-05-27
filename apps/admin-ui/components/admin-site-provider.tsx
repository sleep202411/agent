"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { DEFAULT_ADMIN_SITE, getAdminSite, type AdminSiteCode } from "@/lib/sites";

type AdminSiteContextValue = {
  siteCode: AdminSiteCode;
  site: ReturnType<typeof getAdminSite>;
  setSiteCode: (site: AdminSiteCode) => void;
};

const AdminSiteContext = createContext<AdminSiteContextValue | null>(null);

type AdminSiteProviderProps = {
  children: React.ReactNode;
};

export function AdminSiteProvider({ children }: AdminSiteProviderProps) {
  const [siteCode, setSiteCodeState] = useState<AdminSiteCode>(DEFAULT_ADMIN_SITE);

  const setSiteCode = useCallback((nextSite: AdminSiteCode) => {
    setSiteCodeState(nextSite);
  }, []);

  const value = useMemo(
    () => ({
      siteCode,
      site: getAdminSite(siteCode),
      setSiteCode,
    }),
    [siteCode, setSiteCode]
  );

  return <AdminSiteContext.Provider value={value}>{children}</AdminSiteContext.Provider>;
}

export function useAdminSite() {
  const context = useContext(AdminSiteContext);

  if (!context) {
    throw new Error("useAdminSite must be used within AdminSiteProvider");
  }

  return context;
}
