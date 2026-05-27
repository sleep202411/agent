export type AdminNavItem = {
  href: string;
  label: string;
  eyebrow: string;
};

export const adminNavItems: AdminNavItem[] = [
  { href: "/", label: "Overview", eyebrow: "OV" },
  { href: "/ai-jobs", label: "AI Jobs", eyebrow: "AI" },
  { href: "/wallets", label: "Wallets", eyebrow: "WA" },
  { href: "/campaigns", label: "Campaigns", eyebrow: "CA" },
  { href: "/users", label: "Users", eyebrow: "US" },
  { href: "/audit-logs", label: "Audit Logs", eyebrow: "AL" },
];
