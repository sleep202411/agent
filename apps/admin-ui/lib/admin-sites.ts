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

const ALL_ADMIN_SITE_OPTIONS: AdminSiteOption[] = [
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

const enabledSiteKeys = parseEnabledSiteKeys(process.env.NEXT_PUBLIC_ADMIN_ENABLED_SITES);

export const ADMIN_SITE_OPTIONS: AdminSiteOption[] = ALL_ADMIN_SITE_OPTIONS.filter((site) =>
  enabledSiteKeys.includes(site.key)
);

export const DEFAULT_ADMIN_SITE_KEY: AdminSiteKey = ADMIN_SITE_OPTIONS[0]?.key ?? "global";

export function normalizeAdminSiteKey(value: unknown): AdminSiteKey {
  const key = value === "cn" ? "cn" : value === "global" ? "global" : DEFAULT_ADMIN_SITE_KEY;
  return enabledSiteKeys.includes(key) ? key : DEFAULT_ADMIN_SITE_KEY;
}

export function adminSiteByKey(key: AdminSiteKey): AdminSiteOption {
  return ADMIN_SITE_OPTIONS.find((site) => site.key === key) ?? ADMIN_SITE_OPTIONS[0];
}

function parseEnabledSiteKeys(value: string | undefined): AdminSiteKey[] {
  const keys = (value ?? "global,cn")
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is AdminSiteKey => item === "global" || item === "cn");
  return keys.length > 0 ? keys : ["global"];
}
