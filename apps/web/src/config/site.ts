export type SiteRegion = "cn" | "global";
export type PaymentProvider = "wechat" | "airwallex";

interface CurrencyOption {
  code: string;
  symbol: string;
}

interface SiteConfig {
  region: SiteRegion;
  currencies: CurrencyOption[];
  defaultCurrency: string;
  currencySymbol: string;
  paymentProviders: PaymentProvider[];
}

const configs: Record<SiteRegion, SiteConfig> = {
  cn: {
    region: "cn",
    currencies: [{ code: "CNY", symbol: "¥" }],
    defaultCurrency: "CNY",
    currencySymbol: "¥",
    paymentProviders: ["wechat"],
  },
  global: {
    region: "global",
    currencies: [
      { code: "USD", symbol: "$" },
      { code: "SGD", symbol: "S$" },
    ],
    defaultCurrency: "USD",
    currencySymbol: "$",
    paymentProviders: ["airwallex"],
  },
};

import { env } from "@/src/env";

const region = (env.SITE_REGION as SiteRegion) || "global";

export const siteConfig = configs[region];
