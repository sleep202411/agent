# Region and country architecture

FizzDragon uses two independent dimensions: the deployment cell selects the
application's data and configuration; the request country selects relevant
product behavior within that cell.

## Deployment cells

| Cell                             | Current production data plane                                                     | Configuration                                                |
| -------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| International (`com` / `global`) | Alibaba Cloud Singapore ACK, RDS PostgreSQL and Redis; new media in Cloudflare R2 | `NEXT_PUBLIC_SITE_REGION=global` in the current `.com` build |
| China (`cn`)                     | Independent Alibaba Cloud Hangzhou ACK, PostgreSQL, Redis and OSS                 | `NEXT_PUBLIC_SITE_REGION=cn`                                 |

`com` and `global` are accepted international identifiers. `global` is an explicit
alias, not a fallback that enables every feature. Missing or invalid region
configuration fails. Web reads `NEXT_PUBLIC_SITE_REGION`; Server reads that value
or `SITE_REGION` when the public variable is absent.

The two production cells have independent databases, runtime Secrets, storage
and Java endpoints. They do not synchronize customer data. International Java /
MySQL services remain separate from the Singapore application account. The root
`.com` domain and `www` retain Azure Front Door, and existing Azure Blob assets
remain readable; those retained dependencies do not make Azure the current
application deployment target. See the [production runbook](../deploy/aliyun-sg/README.md).

Country is a per-request ISO 3166-1 alpha-2 code such as `US`, `DE` or `JP`.
Changing country does not choose another database, cloud account or cell. Feature
gates express the current product policy; they are not a legal determination
about residency or cross-border processing.

## Country normalization

`apps/web/proxy.ts` normalizes CDN geo headers into `x-country`, taking
`cf-ipcountry`, `x-vercel-ip-country` and `x-azure-clientip-country` in that order,
with `US` as the fallback. Unknown Cloudflare `XX` is not forwarded as a country.
Web's `detectCountry` reads the normalized header, then a valid Cloudflare header,
and falls back to `US`.

Server's `CountryMiddleware` reads `x-country` first and retains the same CDN
header fallbacks for requests that do not pass through Web. It supplies
`req.country` and request geo context. Country headers carry request context;
project/workspace authorization remains an independent Server responsibility.

## Feature gates

Web's matrix defines cell availability and optional country allowlists. Server's
matrix contains the corresponding server-enforced capabilities; UI-only notices
do not need a Server entry. For example:

- `crew` and `notifications` are available in both cells.
- `imageGeneration` is currently international; `adaptiveStoryPlayback` is CN.
- `gdprCookieBanner` is country-gated in the international Web UI.
- `azureBlobUpload` is a retained capability key. Its name does not describe the
  current infrastructure or override an asset's stored provider.

Client components use the existing region provider:

```tsx
import { useCountry, useFeature } from "@/src/lib/region/provider";

function PrivacyNotice() {
  const country = useCountry();
  const show = useFeature("gdprCookieBanner");
  return show ? <CookieNotice country={country} /> : null;
}
```

Server components can call `hasFeature(name, country)` directly after country
detection. Nest controllers obtain request country with `@Country()` and enforce
server-side gates before performing the operation. Hiding a Web control does not
enforce access to its API.

To add a capability, define its allowed cells and, where needed, countries in the
Web matrix. Add a matching Server gate for server-backed operations and test both
allowed and denied paths. Pass the resolved country when evaluating a
country-restricted rule. Currency policy remains cell-based: CN uses CNY;
international uses USD.

## Source map

| Responsibility               | Source                                                |
| ---------------------------- | ----------------------------------------------------- |
| Web cell and currency policy | `apps/web/src/lib/region/cell.ts`                     |
| Web country detection        | `apps/web/src/lib/region/country.ts`                  |
| Web feature matrix           | `apps/web/src/lib/region/features.ts`                 |
| Web provider and hooks       | `apps/web/src/lib/region/provider.tsx`                |
| Edge normalization           | `apps/web/proxy.ts`                                   |
| Server cell                  | `apps/server/src/common/region/current-cell.ts`       |
| Server country middleware    | `apps/server/src/common/region/country.middleware.ts` |
| Server decorator             | `apps/server/src/common/region/country.decorator.ts`  |
| Server feature matrix        | `apps/server/src/common/region/features.ts`           |
