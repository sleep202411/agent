import type { Icon } from "@tabler/icons-react";
import {
  IconArchive,
  IconBooks,
  IconChartBar,
  IconFileCheck,
  IconFileImport,
  IconFlag,
  IconGavel,
  IconLockOpen,
  IconReceipt,
  IconShieldCheck,
  IconTicket,
  IconWallet,
} from "@tabler/icons-react";

export type IpCommerceNavKey = "market" | "operations" | "commerce" | "review" | "migration";

export type IpCommerceStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "scheduled"
  | "published"
  | "hidden";

export type IpCommerceIpKey = "hawParVilla" | "moonMarket" | "ghostKitchen" | "orbitKids";

export type IpCommerceMetricKey = "published" | "presale" | "review";

export interface IpCommerceIp {
  key: IpCommerceIpKey;
  status: IpCommerceStatus;
  visibility: "public" | "unlisted" | "private";
  image: string;
  tone: string;
  price: number;
  earlyBirdPrice?: number;
  episodes: number;
  sold: number;
  progress: number;
  unlockDate?: string;
  tags: string[];
}

export interface IpCommerceMetric {
  key: IpCommerceMetricKey;
  value: string;
  delta: string;
  icon: Icon;
}

export interface IpCommerceChecklistItem {
  key: string;
  done: boolean;
  icon: Icon;
}

export interface IpCommerceFlowStep {
  key: string;
  icon: Icon;
}

export interface IpCommerceReviewItem {
  key: string;
  status: "blocked" | "waiting" | "passed";
  icon: Icon;
}

export interface IpCommerceImportStep {
  key: string;
  state: "done" | "running" | "pending";
}

export const NAV_ITEMS: Array<{ key: IpCommerceNavKey; icon: Icon; href: string }> = [
  { key: "market", icon: IconBooks, href: "#market" },
  { key: "operations", icon: IconChartBar, href: "#operations" },
  { key: "commerce", icon: IconWallet, href: "#commerce" },
  { key: "review", icon: IconShieldCheck, href: "#review" },
  { key: "migration", icon: IconFileImport, href: "#migration" },
];

export const METRICS: IpCommerceMetric[] = [
  { key: "published", value: "12", delta: "+3", icon: IconBooks },
  { key: "presale", value: "58.4k", delta: "+18%", icon: IconTicket },
  { key: "review", value: "4", delta: "2h", icon: IconFileCheck },
];

export const IPS: IpCommerceIp[] = [
  {
    key: "hawParVilla",
    status: "scheduled",
    visibility: "public",
    image:
      "https://images.unsplash.com/photo-1579546929518-9e396f3cc809?auto=format&fit=crop&w=1200&q=80",
    tone: "from-[#2a1110] via-[#5c1d18] to-[#101010]",
    price: 1550,
    earlyBirdPrice: 750,
    episodes: 8,
    sold: 326,
    progress: 78,
    unlockDate: "2026-07-15",
    tags: ["presale", "interactive", "featured"],
  },
  {
    key: "moonMarket",
    status: "published",
    visibility: "public",
    image:
      "https://images.unsplash.com/photo-1485827404703-89b55fcc595e?auto=format&fit=crop&w=1200&q=80",
    tone: "from-[#1d2430] via-[#243b53] to-[#0f0f10]",
    price: 880,
    episodes: 6,
    sold: 1180,
    progress: 100,
    tags: ["series", "top"],
  },
  {
    key: "ghostKitchen",
    status: "approved",
    visibility: "unlisted",
    image:
      "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80",
    tone: "from-[#253124] via-[#53623e] to-[#171717]",
    price: 420,
    episodes: 4,
    sold: 0,
    progress: 86,
    tags: ["rights", "ready"],
  },
  {
    key: "orbitKids",
    status: "draft",
    visibility: "private",
    image:
      "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=1200&q=80",
    tone: "from-[#362b1d] via-[#8a6a35] to-[#15120e]",
    price: 360,
    episodes: 3,
    sold: 0,
    progress: 42,
    tags: ["draft", "kids"],
  },
];

export const CHECKLIST: IpCommerceChecklistItem[] = [
  { key: "content", done: true, icon: IconBooks },
  { key: "pricing", done: true, icon: IconTicket },
  { key: "rights", done: true, icon: IconShieldCheck },
  { key: "review", done: false, icon: IconGavel },
];

export const COMMERCE_FLOW: IpCommerceFlowStep[] = [
  { key: "priceRule", icon: IconTicket },
  { key: "order", icon: IconReceipt },
  { key: "wallet", icon: IconWallet },
  { key: "entitlement", icon: IconLockOpen },
  { key: "collection", icon: IconArchive },
];

export const REVIEW_ITEMS: IpCommerceReviewItem[] = [
  { key: "rights", status: "passed", icon: IconShieldCheck },
  { key: "aiDisclosure", status: "waiting", icon: IconFileCheck },
  { key: "report", status: "blocked", icon: IconFlag },
];

export const IMPORT_STEPS: IpCommerceImportStep[] = [
  { key: "select", state: "done" },
  { key: "fetch", state: "done" },
  { key: "normalize", state: "running" },
  { key: "write", state: "pending" },
  { key: "verify", state: "pending" },
];
