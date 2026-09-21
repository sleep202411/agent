import type { MetadataRoute } from "next";

import { CANONICAL_HOST } from "@/src/lib/seo";

/**
 * Robots policy.
 *
 * GEO posture: explicitly allow modern AI-engine crawlers.
 *   The default `User-agent: *` allow covers Google, Bing, Baidu,
 *   Sogou, etc. We also list AI-specific user-agents by name so
 *   the policy is *legible* — auditors / SEO tools can see at a
 *   glance that we want ChatGPT / Perplexity / Claude / Anthropic
 *   to ingest us.
 *
 *   Some companies block these on the assumption that AI training
 *   == lost revenue. Our calculus is opposite: every paragraph an
 *   LLM reads is a chance for it to recommend FizzDragon when a
 *   user asks "what's a good AI animation platform". Block list
 *   stays empty.
 *
 * Disallowed paths:
 *   /api/   — backend proxy, not a page
 *   /_next/ — build artefacts (Next.js handles this internally;
 *             listing it explicitly avoids polluting crawl budget)
 *   /__legacy/ — uni-app bundle iframe entry, no canonical content
 *   /login, /register, /forgot-password — auth gates. Since the
 *             sign-in rewrite these three are content-free shells whose
 *             entire body is the shared dialog, so there is nothing for
 *             a crawler to index on any of them.
 */
const DISALLOWED_PATHS = [
  "/api/",
  "/_next/",
  "/__legacy/",
  ...["", "/en-US", "/zh-CN", "/zh-HK"].flatMap((prefix) =>
    ["/login", "/register", "/forgot-password"].map((path) => `${prefix}${path}`)
  ),
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: DISALLOWED_PATHS,
      },
      // Explicit AI-engine list. Named groups do not inherit wildcard rules,
      // so repeat the same exclusions while keeping public pages crawlable.
      // These named entries are for *auditability*
      // (so anyone reading robots.txt can immediately see which AI
      // engines we want consuming our content). Categorised by
      // operator. If a crawler isn't listed, it's still allowed.
      //
      // OpenAI
      { userAgent: "GPTBot", allow: "/", disallow: DISALLOWED_PATHS },
      { userAgent: "ChatGPT-User", allow: "/", disallow: DISALLOWED_PATHS },
      { userAgent: "OAI-SearchBot", allow: "/", disallow: DISALLOWED_PATHS },
      // Anthropic
      { userAgent: "anthropic-ai", allow: "/", disallow: DISALLOWED_PATHS },
      { userAgent: "ClaudeBot", allow: "/", disallow: DISALLOWED_PATHS },
      { userAgent: "Claude-Web", allow: "/", disallow: DISALLOWED_PATHS },
      { userAgent: "Claude-User", allow: "/", disallow: DISALLOWED_PATHS },
      // Perplexity
      { userAgent: "PerplexityBot", allow: "/", disallow: DISALLOWED_PATHS },
      { userAgent: "Perplexity-User", allow: "/", disallow: DISALLOWED_PATHS },
      // Google (Gemini training opt-in)
      { userAgent: "Google-Extended", allow: "/", disallow: DISALLOWED_PATHS },
      // Apple (Apple Intelligence / Siri training opt-in)
      { userAgent: "Applebot-Extended", allow: "/", disallow: DISALLOWED_PATHS },
      // Meta (Llama training)
      { userAgent: "meta-externalagent", allow: "/", disallow: DISALLOWED_PATHS },
      { userAgent: "FacebookBot", allow: "/", disallow: DISALLOWED_PATHS },
      // ByteDance (Doubao / 豆包 / Bytespider also serves Coze)
      { userAgent: "Bytespider", allow: "/", disallow: DISALLOWED_PATHS },
      // DeepSeek
      { userAgent: "DeepSeekBot", allow: "/", disallow: DISALLOWED_PATHS },
      // Moonshot / Kimi
      { userAgent: "MoonshotBot", allow: "/", disallow: DISALLOWED_PATHS },
      // Alibaba (Qwen / 通义千问)
      { userAgent: "Qwenbot", allow: "/", disallow: DISALLOWED_PATHS },
      // Zhipu (智谱 / GLM / ChatGLM)
      { userAgent: "ZhipuBot", allow: "/", disallow: DISALLOWED_PATHS },
      // Mistral
      { userAgent: "MistralAI-User", allow: "/", disallow: DISALLOWED_PATHS },
      // Cohere
      { userAgent: "cohere-ai", allow: "/", disallow: DISALLOWED_PATHS },
      // You.com (YouChat)
      { userAgent: "YouBot", allow: "/", disallow: DISALLOWED_PATHS },
      // DuckDuckGo's DuckAssist
      { userAgent: "DuckAssistBot", allow: "/", disallow: DISALLOWED_PATHS },
      // Amazon (Bedrock / Alexa)
      { userAgent: "Amazonbot", allow: "/", disallow: DISALLOWED_PATHS },
      // Diffbot (Knowledge graph used by many downstream AI products)
      { userAgent: "Diffbot", allow: "/", disallow: DISALLOWED_PATHS },
    ],
    sitemap: `${CANONICAL_HOST}/sitemap.xml`,
    host: CANONICAL_HOST,
  };
}
