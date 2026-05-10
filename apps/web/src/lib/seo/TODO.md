# SEO / GEO — backlog

Companion to `README.md`. Tracks what's shipped, what's queued, and the
non-obvious context behind each item so a future session (mine or a
colleague's) can pick up without re-deriving the ladder.

## ✅ Shipped

- **`src/lib/seo/`** — server-only builders for Organization, WebSite,
  Article, CreativeWork, FAQPage, BreadcrumbList, Course, Person,
  VideoObject, ItemList. All cross-reference `ORGANIZATION_ID`.
- **Root `app/layout.tsx`** — Metadata API (title template, OG, Twitter)
  - `<JsonLd>` for Organization + WebSite on every page.
- **`app/robots.ts`** — explicit allowlist for OpenAI / Anthropic /
  Perplexity / Google / Apple / Meta / ByteDance / DeepSeek / Moonshot
  / Qwen / Zhipu / Mistral / Cohere / You.com / DuckDuckGo / Amazon /
  Diffbot.
- **`app/sitemap.ts`** — 10 routes × 3 locales = 30 entries with
  hreflang.
- **`/news/[id]`** — Article + BreadcrumbList JSON-LD via SSR.
- **`/news/`** (plaza) — ItemList + BreadcrumbList JSON-LD.
- **`/ips/[id]`** — server `page.tsx` server-fetches project + FAQs and
  emits CreativeWork + FAQPage + BreadcrumbList; the original 740-line
  client page moved to `_components/ip-detail-client.tsx`.
- **`/llms.txt`** — markdown index for LLMs at the site root.
- **Privacy policy** — added "Device and Technical Information" section
  per Huawei AppGallery review (2026-05-10). Not strictly GEO but
  blocks app-store distribution, so listed here for completeness.

## 🔲 Page-level schema — not yet wired

Each requires server-side data fetching. The plaza pages are all
`"use client"`, so wiring requires either (a) converting the plaza
`page.tsx` to a server component that hands off to a client child
(pattern used on `/ips/[id]`), or (b) adding a sibling `layout.tsx`
that injects schema (works only when the layout segment is leaf-only).

| Route                | Schema                                                        | Notes                                                                               |
| -------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `/ips/` (plaza)      | ItemList + BreadcrumbList                                     | Need server fetcher for `/project/list`. Cap at 50 items.                           |
| `/creators/` (plaza) | ItemList + BreadcrumbList                                     | Need server fetcher for `/user/creator/list` (or wherever).                         |
| `/creators/[id]`     | Person + BreadcrumbList                                       | Server-fetch user profile. Use `buildPerson`.                                       |
| `/courses/` (plaza)  | ItemList + BreadcrumbList                                     | Need server fetcher.                                                                |
| `/courses/[id]`      | Course + BreadcrumbList                                       | Use `buildCourse`.                                                                  |
| `/crews/` (plaza)    | ItemList + BreadcrumbList                                     | Currently `_crewListProbe` — call API but hide UI. Schema only when CTA re-enabled. |
| `/about`             | already a static page; consider Organization detail expansion | Lower priority.                                                                     |

**Pattern reference**: `app/(site)/ips/[id]/page.tsx` is the canonical
example. Server component → fetches via `_data/server.ts` (best-effort,
returns null on failure) → emits `<JsonLd>` → renders the client
component as a child.

## 🔲 GEO tactics beyond schema

These are the non-structured-data levers. Schema gets you _parsed_;
these are what get you _cited_.

### High-leverage

- **Wikidata entity** — submit a FizzDragon entity on Wikidata with
  `instance of: AI animation platform`, `country: Singapore`, link to
  fizzdragon.com via `official website`, link our schema.org
  Organization `@id` via `described at URL`. Wait until the schema has
  been live ≥ 2 weeks (otherwise the submission gets rejected for
  insufficient external coverage). This is the single most important
  step for AI engines to recognise "FizzDragon" as a _thing_ rather
  than a string.
- **AI crawler log monitoring** — add a small grep over nginx access
  logs (or Vercel logs) for `GPTBot|ClaudeBot|PerplexityBot|DeepSeekBot|CCBot`,
  pipe to a daily summary. Tells us who's actually crawling, what they
  hit, and whether our robots.txt allowlist is working as intended.
  Probably write as a cron + Slack post.
- **Visible-on-page FAQ blocks** — AI engines preference content they
  can quote verbatim. Even where FAQPage JSON-LD is already emitted,
  add a visible H2 + Q/A section in the rendered HTML. Highest-traffic
  candidates: `/`, `/about`, `/courses/[id]`. Don't hide the answers
  behind interactive accordions only — AI engines penalise that.

### Medium

- **Seed long-form content** — 1-2 long posts on Medium / 知乎 /
  小红书 introducing FizzStudio with deep links into specific IP /
  course pages. Provides the "external coverage" Wikidata expects and
  gives AI engines a non-self-referential anchor.
- **`/about` page schema expansion** — add `foundingDate`, `founder`,
  `numberOfEmployees`, `address`, `contactPoint`. Promotes the
  Organization entity to "fully described" tier in Google Knowledge
  Graph terms.
- **`llms-full.txt`** — currently we only ship `/llms.txt`. Once we
  have public docs (API docs, getting-started guide), bundle them into
  `/llms-full.txt` so LLMs can ingest the full corpus in one request.

### Low / aspirational

- **VideoObject schema for IP trailers** — when an IP has a trailer,
  emit `VideoObject` alongside `CreativeWork`. Builder exists
  (`buildVideoObject`); just needs wiring once we settle the trailer
  storage path.
- **Per-route `sitemap.ts`** — split the monolithic `app/sitemap.ts`
  into `app/(site)/news/sitemap.ts`, `app/(site)/ips/sitemap.ts`, etc.,
  each enumerating its own dynamic IDs. Required once we exceed ~5k
  URLs in a single sitemap (we won't for a while).
- **GEO analytics dashboard** — eventually want a way to see _which
  AI engines cite us, on which queries, with what frequency_. No clean
  SaaS for this yet (Profound / AthenaHQ are early); can build a
  manual rotation of "ask ChatGPT/Perplexity/Claude/DeepSeek 'what is
  FizzDragon'" and log responses weekly.

## SSR audit — pending

AI engines read the _first-paint HTML_. They don't run our JS. Pages
where the meaningful content only appears after hydrate are invisible
to them, regardless of how good the JSON-LD is.

Pages to audit (order by traffic):

- [ ] `/` (root) — hero stats / featured IPs are loaded client-side?
- [ ] `/ips/[id]` — story / FAQ visible in SSR? (Currently the page is
      fully client-rendered after the server wrapper landed; SSR HTML only
      contains the schema, not the prose.)
- [ ] `/news/[id]` — already SSR (server component from the start).
- [ ] `/about` — confirm.
- [ ] `/courses/[id]` — confirm.

Method: `curl -A "Mozilla/5.0 (compatible; GPTBot/1.0)" $URL | grep -c "<expected text>"` for a known string. If 0, the content is hydration-only and needs an SSR fallback.

## Conventions

- Every JSON-LD goes through `<JsonLd>` from `src/lib/seo`. Never
  inline `<script type="application/ld+json">` directly — JsonLd
  handles XSS escaping and ensures server-only rendering.
- Cross-document `@id` references are deliberate — they let crawlers
  dedupe entities across pages. Don't replace them with inline copies.
- All URLs in JSON-LD resolve against `CANONICAL_HOST` (currently
  `https://fizzdragon.com`). The `.cn` mirror points at the same
  canonical host so both deployments contribute to one brand graph.
- Schema fetchers in `_data/server.ts` files MUST return null / empty
  on failure, never throw. Best-effort SEO must not 500 a page.

## Open questions

- Do we want an explicit "company structured data" page like
  `/company.json` that documents our entity for AI consumption? (Not
  standard yet, but some engines have been asked about it.)
- Should the .cn deployment emit different `sameAs` targets in
  Organization (Weibo, Bilibili) vs the .com deployment (X, YouTube)?
  Currently both ship the same Organization payload. Probably worth
  splitting once we add social presence on either.
