import { appEnv, type AppLocale } from "@/config";

import enUS from "./messages/en-US.json";
import zhCN from "./messages/zh-CN.json";
import zhHK from "./messages/zh-HK.json";

type MessageKey = keyof typeof enUS;

const catalogs = {
  "en-US": enUS,
  "zh-CN": zhCN,
  "zh-HK": zhHK,
} satisfies Record<AppLocale, Record<MessageKey, string>>;

export function t(key: MessageKey) {
  return catalogs[appEnv.defaultLocale]?.[key] ?? enUS[key] ?? key;
}
