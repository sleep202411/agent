/**
 * Locale-keyed FAQ data. The page picks the right list via
 * `useLocale()` at render time; falls back to zh-CN if a locale ever
 * adds without its own translation landing (defensive — all three
 * locales currently ship a full set).
 */

import type { Locale } from "@/src/i18n/config";
import { FAQ_EN_US } from "./faqs.en-us";
import { FAQ_ZH_CN } from "./faqs.zh-cn";
import { FAQ_ZH_HK } from "./faqs.zh-hk";
import type { FaqCategory } from "./types";

export type { FaqCategory, FaqItem } from "./types";

export const FAQ_BY_LOCALE: Record<Locale, FaqCategory[]> = {
  "en-US": FAQ_EN_US,
  "zh-CN": FAQ_ZH_CN,
  "zh-HK": FAQ_ZH_HK,
};

export function getFaqForLocale(locale: Locale): FaqCategory[] {
  return FAQ_BY_LOCALE[locale] ?? FAQ_ZH_CN;
}

/**
 * UI shell copy that wraps the Q&A list — hero, rail label, empty
 * footer note. Kept here next to the content so a future translation
 * pass touches one directory; not split into `messages/*.json`
 * because these strings only exist on the FAQ surface.
 */
export interface FaqShell {
  heroEyebrow: string;
  heroTitle: string;
  heroIntro: string;
  railLabel: string;
  closingTitle: string;
  /** Sentence with a `{site}` placeholder so we can render the bare
   *  domain in a slightly different colour without splitting copy. */
  closingBody: string;
  metaTitle: string;
  metaDescription: string;
  metaOgTitle: string;
  metaOgDescription: string;
  breadcrumbHome: string;
  breadcrumbFaq: string;
}

const SITE_DOMAIN = "fizzdragon.com";

export const FAQ_SHELL_BY_LOCALE: Record<Locale, FaqShell> = {
  "en-US": {
    heroEyebrow: "FizzDragon · FAQ",
    heroTitle: "About FizzDragon and AI cinema",
    heroIntro:
      "From production workflow and tech, to pricing, partnerships, and the road ahead — covering what creators, clients, investors, and the curious most want to know. Every answer grounded in shipped product and shipped work.",
    railLabel: "CATEGORIES",
    closingTitle: "Didn't find your question?",
    closingBody: `These cover what FizzDragon and AI cinema are most often asked. For anything deeper, reach out via ${SITE_DOMAIN} or our social channels.`,
    metaTitle: "FAQ · FizzDragon",
    metaDescription:
      "About FizzDragon and AI cinema — production flow, cost, timeline, technology, partnerships and what comes next. Plain-language answers grounded in shipped work.",
    metaOgTitle: "FAQ · FizzDragon",
    metaOgDescription:
      "About FizzDragon and AI cinema — plain-language answers grounded in shipped work.",
    breadcrumbHome: "Home",
    breadcrumbFaq: "FAQ",
  },
  "zh-CN": {
    heroEyebrow: "FizzDragon · 常见问题",
    heroTitle: "关于 FizzDragon 与 AI 电影",
    heroIntro:
      "从制作流程、技术原理，到价格、合作方式与未来路线 —— 覆盖创作者、客户、投资方与好奇者最常关心的核心问题。每一条都基于已落地的产品与作品事实。",
    railLabel: "分类",
    closingTitle: "没找到你的问题？",
    closingBody: `以上覆盖了 FizzDragon 与 AI 电影最常被问到的方向，欢迎通过官网 ${SITE_DOMAIN} 或社交媒体联系我们获取更深入的信息。`,
    metaTitle: "常见问题 · FizzDragon",
    metaDescription:
      "关于 FizzDragon 与 AI 电影 —— 从制作流程、成本时长、技术原理到合作方式。基于已落地产品与作品的常见问题解答。",
    metaOgTitle: "常见问题 · FizzDragon",
    metaOgDescription: "关于 FizzDragon 与 AI 电影 —— 基于已落地产品与作品的常见问题解答。",
    breadcrumbHome: "首页",
    breadcrumbFaq: "常见问题",
  },
  "zh-HK": {
    heroEyebrow: "FizzDragon · 常見問題",
    heroTitle: "關於 FizzDragon 與 AI 電影",
    heroIntro:
      "從製作流程、技術原理，到價格、合作方式與未來路線 —— 覆蓋創作者、客戶、投資方與好奇者最常關心的核心問題。每一條都基於已落地的產品與作品事實。",
    railLabel: "分類",
    closingTitle: "沒找到你的問題？",
    closingBody: `以上覆蓋了 FizzDragon 與 AI 電影最常被問到的方向，歡迎透過官網 ${SITE_DOMAIN} 或社交媒體聯絡我們以獲取更深入的資訊。`,
    metaTitle: "常見問題 · FizzDragon",
    metaDescription:
      "關於 FizzDragon 與 AI 電影 —— 從製作流程、成本時長、技術原理到合作方式。基於已落地產品與作品的常見問題解答。",
    metaOgTitle: "常見問題 · FizzDragon",
    metaOgDescription: "關於 FizzDragon 與 AI 電影 —— 基於已落地產品與作品的常見問題解答。",
    breadcrumbHome: "首頁",
    breadcrumbFaq: "常見問題",
  },
};

export function getFaqShellForLocale(locale: Locale): FaqShell {
  return FAQ_SHELL_BY_LOCALE[locale] ?? FAQ_SHELL_BY_LOCALE["zh-CN"];
}
