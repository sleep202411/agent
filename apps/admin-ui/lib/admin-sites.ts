export const ADMIN_SITE_COOKIE = "fd_admin_site";

export type AdminSiteKey = "global" | "cn";

export type AdminSiteOption = {
  key: AdminSiteKey;
  label: string;
  shortLabel: string;
  domain: string;
  databaseLabel: string;
  badge: string;
};

export const ADMIN_SITE_OPTIONS: AdminSiteOption[] = [
  {
    key: "global",
    label: "FizzDragon.com",
    shortLabel: "国际站",
    domain: "fizzdragon.com",
    databaseLabel: "国际站生产数据库",
    badge: ".com",
  },
  {
    key: "cn",
    label: "FizzDragon CN",
    shortLabel: "中国站",
    domain: "fizzdragon.fizzspace.cn",
    databaseLabel: "中国站生产数据库",
    badge: ".cn",
  },
];

export const DEFAULT_ADMIN_SITE_KEY: AdminSiteKey = "global";

export function normalizeAdminSiteKey(value: unknown): AdminSiteKey {
  return value === "cn" ? "cn" : DEFAULT_ADMIN_SITE_KEY;
}

export function adminSiteByKey(key: AdminSiteKey): AdminSiteOption {
  return ADMIN_SITE_OPTIONS.find((site) => site.key === key) ?? ADMIN_SITE_OPTIONS[0];
}
