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

export function adminSiteByKey(key: AdminSiteKey): AdminSiteOption {
  return ADMIN_SITE_OPTIONS.find((site) => site.key === key) ?? ADMIN_SITE_OPTIONS[0];
}

// Resolves the deploy-time single-site identity from the ADMIN_SITE env.
// ADMIN_SITE is a server-only env (not NEXT_PUBLIC); currentAdminSite() is only
// ever called server-side. If the resolved option ever needs client access,
// pass the AdminSiteOption down as a prop (as the login page already does).
export function currentAdminSite(): AdminSiteOption {
  if (process.env.ADMIN_SITE !== "cn" && process.env.ADMIN_SITE !== "global")
    throw new Error("ADMIN_SITE must be cn or global");
  const key: AdminSiteKey = process.env.ADMIN_SITE;
  const site = adminSiteByKey(key);
  if (!isLocalAdminApiBase()) return site;
  return {
    ...site,
    label: `${site.label} Local`,
    domain: "localhost",
    databaseLabel: "本地开发数据库",
  };
}

function isLocalAdminApiBase(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  const base = process.env.ADMIN_API_BASE_URL ?? process.env.ADMIN_GLOBAL_API_BASE_URL;
  try {
    if (!base) return false;
    const parsed = new URL(base);
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname);
  } catch {
    return false;
  }
}
