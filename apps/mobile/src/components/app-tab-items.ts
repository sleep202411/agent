import type { Href } from "expo-router";

import type { AppIconName } from "./app-icon";

import type { MessageKey } from "@/i18n";

export type AppTabItem = {
  href: Href;
  icon: AppIconName;
  labelKey: MessageKey;
  name: string;
};

export const appTabItems = [
  {
    href: "/(tabs)" as Href,
    icon: "home",
    labelKey: "tabs.home",
    name: "index",
  },
  {
    href: "/creators" as Href,
    icon: "creators",
    labelKey: "tabs.creators",
    name: "creators",
  },
  {
    href: "/crews" as Href,
    icon: "crews",
    labelKey: "tabs.crews",
    name: "crews",
  },
  {
    href: "/courses" as Href,
    icon: "news",
    labelKey: "tabs.courses",
    name: "courses",
  },
  {
    href: "/mine" as Href,
    icon: "mine",
    labelKey: "tabs.mine",
    name: "mine",
  },
] as const satisfies readonly AppTabItem[];
