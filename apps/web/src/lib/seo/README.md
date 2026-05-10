# SEO / GEO infrastructure

Server-only schema.org JSON-LD builders + the `<JsonLd>` injector,
plus the project's `robots.ts` / `sitemap.ts` policy.

## Scope

This module ships **structured data** (schema.org JSON-LD). It does
NOT ship `<title>` / `<meta>` tags — those go through Next.js's
[Metadata API](https://nextjs.org/docs/app/api-reference/functions/generate-metadata)
in each route's `export const metadata` or `generateMetadata()`.

Both surfaces should agree: structured data describes the same
entity the page's `<title>` + `<meta description>` claim it does.

## Quick reference

| Page                                       | Builder(s)                                                                  |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| Root layout (every page)                   | `buildOrganization()` + `buildWebSite()`                                    |
| Plaza grid (`/ips`, `/crews`, `/creators`) | `buildItemList(...)` + `buildBreadcrumbList(...)`                           |
| IP detail `/ips/[id]`                      | `buildCreativeWork(...)` + `buildFaqPage(...)` + `buildBreadcrumbList(...)` |
| News article `/news/[id]`                  | `buildArticle(...)` + `buildBreadcrumbList(...)`                            |
| Course detail `/courses/[id]`              | `buildCourse(...)` + `buildBreadcrumbList(...)`                             |
| Creator profile `/creators/[id]`           | `buildPerson(...)` + `buildBreadcrumbList(...)`                             |
| Standalone video `/.../video`              | `buildVideoObject(...)` + `buildBreadcrumbList(...)`                        |

## Why `"server-only"` everywhere

Every file in this module imports `"server-only"`. Reasons:

1. **No client bundle bloat** — JSON-LD blobs are noise inside the
   client JS bundle. They belong in the SSR HTML.
2. **GEO requires SSR delivery** — crawlers and AI engines read the
   first-paint HTML. Anything that ships JSON-LD via `useEffect`
   after hydrate is invisible to them.
3. **Build-time guard** — accidental `import { buildArticle }` from a
   client component fails the Next.js build instead of silently
   shipping the wrong thing.

For pages that are currently `"use client"`, the right fix is to
turn the page file into a server component and move the existing
client logic into a child component. See the IP detail v2
implementation as a reference.

## Embedding into a page (server component)

```tsx
import { JsonLd, buildArticle, buildBreadcrumbList } from "@/src/lib/seo";

export default async function NewsArticlePage({ params }) {
  const { id, locale } = await params;
  const article = await fetchArticle(id);

  return (
    <>
      <JsonLd
        data={[
          buildArticle({
            url: `/${locale}/news/${id}`,
            inLanguage: locale,
            headline: article.title,
            description: article.summary,
            image: article.cover,
            datePublished: article.publishedAt,
            dateModified: article.updatedAt,
            authors: article.authors,
          }),
          buildBreadcrumbList([
            { name: "News", url: `/${locale}/news` },
            { name: article.title, url: `/${locale}/news/${id}` },
          ]),
        ]}
      />
      <ArticleClient article={article} />
    </>
  );
}
```

## Validation

After every change to a builder or a page wiring up new schema:

1. **Build & curl** — `npm run build && npm run start`, then
   `curl https://fizzdragon.com/<route>` and grep
   `<script type="application/ld+json">` to confirm the JSON-LD
   landed in the SSR HTML.
2. **Schema.org validator** — paste the raw JSON-LD into
   <https://validator.schema.org/> for syntax checks.
3. **Google Rich Results Test** — paste the page URL into
   <https://search.google.com/test/rich-results> to see which rich
   results Google is willing to render.
4. **GEO smoke test** — 1–2 weeks after deploy, ask
   ChatGPT / Perplexity / Kimi about the entity (e.g. "What is
   FizzDragon?", "Who made the Gesar IP?") and confirm citations.

## Anti-patterns

- ❌ Don't fabricate fields the page doesn't actually display
  (e.g. `aggregateRating` without a real rating). Google flags as
  spam, drops rich-result eligibility.
- ❌ Don't re-inline a full `Organization` per page. Reference it
  via `{ "@id": ORGANIZATION_ID }` instead.
- ❌ Don't pass HTML in `description` / `text` fields — JSON-LD
  consumers expect plain text.
- ❌ Don't gate FAQ Q&A behind interactive UI that hides the answer
  text from the rendered HTML — Google requires the answer to be
  present in the same DOM the page serves.
- ❌ Don't fork the canonical host between deployments. The .com
  and .cn deployments emit identical `url` fields pointing at
  fizzdragon.com so search engines treat them as one entity.

## Adding a new builder

1. Add a typed input interface (one source of truth for the
   schema's shape, separate from schema.org's loose typing).
2. Use `schema-dts`'s `WithContext<X>` for the return type so
   TypeScript catches missing required fields.
3. Reference Organization via `ORGANIZATION_ID` rather than
   inlining the brand object.
4. Use `absoluteUrl()` on every URL field so paths and absolute
   URLs both work.
5. Re-export from `index.ts`.
6. Document why it exists and when not to use it (the comment
   header is for future-you).
