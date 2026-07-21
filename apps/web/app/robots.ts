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
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/_next/", "/__legacy/", "/login", "/register", "/forgot-password"],
      },
      // Explicit AI-engine allow list. The wildcard above already
      // allows everything — these named entries are for *auditability*
      // (so anyone reading robots.txt can immediately see which AI
      // engines we want consuming our content). Categorised by
      // operator. If a crawler isn't listed, it's still allowed.
      //
      // OpenAI
      { userAgent: "GPTBot", allow: "/" },
      { userAgent: "ChatGPT-User", allow: "/" },
      { userAgent: "OAI-SearchBot", allow: "/" },
      // Anthropic
      { userAgent: "anthropic-ai", allow: "/" },
      { userAgent: "ClaudeBot", allow: "/" },
      { userAgent: "Claude-Web", allow: "/" },
      { userAgent: "Claude-User", allow: "/" },
      // Perplexity
      { userAgent: "PerplexityBot", allow: "/" },
      { userAgent: "Perplexity-User", allow: "/" },
      // Google (Gemini training opt-in)
      { userAgent: "Google-Extended", allow: "/" },
      // Apple (Apple Intelligence / Siri training opt-in)
      { userAgent: "Applebot-Extended", allow: "/" },
      // Meta (Llama training)
      { userAgent: "meta-externalagent", allow: "/" },
      { userAgent: "FacebookBot", allow: "/" },
      // ByteDance (Doubao / 豆包 / Bytespider also serves Coze)
      { userAgent: "Bytespider", allow: "/" },
      // DeepSeek
      { userAgent: "DeepSeekBot", allow: "/" },
      // Moonshot / Kimi
      { userAgent: "MoonshotBot", allow: "/" },
      // Alibaba (Qwen / 通义千问)
      { userAgent: "Qwenbot", allow: "/" },
      // Zhipu (智谱 / GLM / ChatGLM)
      { userAgent: "ZhipuBot", allow: "/" },
      // Mistral
      { userAgent: "MistralAI-User", allow: "/" },
      // Cohere
      { userAgent: "cohere-ai", allow: "/" },
      // You.com (YouChat)
      { userAgent: "YouBot", allow: "/" },
      // DuckDuckGo's DuckAssist
      { userAgent: "DuckAssistBot", allow: "/" },
      // Amazon (Bedrock / Alexa)
      { userAgent: "Amazonbot", allow: "/" },
      // Diffbot (Knowledge graph used by many downstream AI products)
      { userAgent: "Diffbot", allow: "/" },
    ],
    sitemap: `${CANONICAL_HOST}/sitemap.xml`,
    host: CANONICAL_HOST,
  };
}
