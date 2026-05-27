export type AdminSiteCode = "global" | "cn";

export type AdminSite = {
  code: AdminSiteCode;
  label: string;
  domain: string;
  market: string;
  paymentRail: "airewa" | "wechat_pay";
  settlementCurrency: "USD" | "CNY";
  apiBaseEnvVar: string;
  fallbackApiBaseUrl: string;
};

export const ADMIN_SITES: AdminSite[] = [
  {
    code: "global",
    label: "Global (.com)",
    domain: "fizzdragon.com",
    market: "International",
    paymentRail: "airewa",
    settlementCurrency: "USD",
    apiBaseEnvVar: "NEXT_PUBLIC_ADMIN_GLOBAL_API_BASE",
    fallbackApiBaseUrl: "https://api.fizzdragon.com/aurora/admin",
  },
  {
    code: "cn",
    label: "China (.cn)",
    domain: "fizzdragon.fizzspace.cn",
    market: "Mainland China",
    paymentRail: "wechat_pay",
    settlementCurrency: "CNY",
    apiBaseEnvVar: "NEXT_PUBLIC_ADMIN_CN_API_BASE",
    fallbackApiBaseUrl: "https://fizzdragon.fizzspace.cn/aurora/admin",
  },
];

export const DEFAULT_ADMIN_SITE: AdminSiteCode = "global";

export function isAdminSiteCode(value: string): value is AdminSiteCode {
  return value === "global" || value === "cn";
}

export function getAdminSite(code: AdminSiteCode): AdminSite {
  return ADMIN_SITES.find((site) => site.code === code) ?? ADMIN_SITES[0];
}

export function getAdminApiBaseUrl(code: AdminSiteCode): string {
  const site = getAdminSite(code);
  const configured =
    code === "global"
      ? process.env.NEXT_PUBLIC_ADMIN_GLOBAL_API_BASE
      : process.env.NEXT_PUBLIC_ADMIN_CN_API_BASE;

  return configured || site.fallbackApiBaseUrl;
}
