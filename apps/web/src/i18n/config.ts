export const locales = ["zh-CN", "zh-HK", "en-US"] as const;
export const defaultLocale = "zh-CN" as const;

export type Locale = (typeof locales)[number];
