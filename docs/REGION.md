# Region & Country architecture

How fizzdragon-platform serves multiple regions from one codebase.

## Two layers

The platform has **two orthogonal dimensions** of regional variation:

| Layer       | Granularity    | Resolution time | Driver                            |
| ----------- | -------------- | --------------- | --------------------------------- |
| **Cell**    | Deployment     | Build time      | Infra isolation, legal residency  |
| **Country** | Single request | Per request     | UX, compliance, payments, content |

A **cell** is a fully self-contained deployment of the platform. Each
cell has its own data plane — its own PG, object storage, realtime,
secrets. Cells **do not share data**. We run exactly two cells in
production:

- **`com`** — Azure (Singapore region today). Serves all non-China
  traffic from one data plane. Built with `NEXT_PUBLIC_SITE_REGION=com`.
- **`cn`** — Alibaba (Mainland). Serves China traffic only. Built with
  `NEXT_PUBLIC_SITE_REGION=cn`. Required by PIPL + 网络安全法 to keep
  Chinese user data inside China.

A third **`global`** value is reserved for local-dev fallback when no
env is set. It enables every feature so dev exercises both cells'
code paths.

**Country** is a per-request attribute, ISO 3166-1 alpha-2 (`US`,
`DE`, `JP`, etc.). The com cell sees many countries; the cn cell sees
only `CN` (geofenced upstream). UX, compliance copy, payment methods,
and content licensing vary per country within the com cell — without
needing a separate deployment for each country.

```
                       ┌──────────── com cell (Azure SG) ───────────┐
                       │                                              │
   user from US ──────►│ ──→ x-country: US  →  Airwallex, CCPA      │
   user from DE ──────►│ ──→ x-country: DE  →  Airwallex, GDPR      │
   user from JP ──────►│ ──→ x-country: JP  →  Airwallex            │
                       │       (single data plane: Azure PG + Blob)  │
                       └──────────────────────────────────────────────┘

                       ┌──────────── cn cell (Alibaba) ─────────────┐
   user from CN ──────►│ ──→ x-country: CN  →  WeChat Pay, PIP      │
                       │       (separate data plane: Alibaba RDS)    │
                       └──────────────────────────────────────────────┘
```

## Header normalization

Different CDNs emit different geo headers. The Next.js proxy
(`apps/web/proxy.ts`) collapses them into one canonical
`x-country` header, **once at the edge**:

```ts
// proxy.ts (simplified)
const country =
  request.headers.get("cf-ipcountry") ||
  request.headers.get("x-vercel-ip-country") ||
  request.headers.get("x-azure-clientip-country") ||
  "US";
headers.set("x-country", country.toUpperCase());
```

Everything downstream — server components, Nest middleware, gateways —
reads only `x-country`. The proxy is the single source of truth.

## How to use it

### Web (Next.js)

Wrap the root layout once (already done — see `app/layout.tsx`):

```tsx
import { headers } from "next/headers";
import { detectCountry } from "@/src/lib/region/country";
import { RegionProvider } from "@/src/lib/region/provider";

export default async function RootLayout({ children }) {
  const country = detectCountry(await headers());
  return <RegionProvider country={country}>{children}</RegionProvider>;
}
```

Then anywhere in client code:

```tsx
import { useCountry, useFeature } from "@/src/lib/region/provider";

function PaymentBlock() {
  const country = useCountry(); // "US" / "DE" / ...
  const airwallexAvailable = useFeature("airwallexPay");
  if (!airwallexAvailable) return null;
  return <AirwallexButton />;
}
```

In server components, call `hasFeature` directly:

```tsx
import { detectCountry } from "@/src/lib/region/country";
import { hasFeature } from "@/src/lib/region/features";

export default async function Page() {
  const country = detectCountry(await headers());
  if (hasFeature("imageGeneration", country)) {
    return <ImageGenerator />;
  }
  return <UpgradePrompt />;
}
```

### Server (Nest)

`RegionModule` (imported once from `AppModule`) wires `CountryMiddleware`
globally. Every controller sees `req.country`. To use it:

```ts
import { Country } from "@/common/region";

@Controller("payment")
export class PaymentController {
  @Post("checkout")
  checkout(@Country() country: string, @Body() body: CheckoutDto) {
    if (!hasFeature("airwallexPay", country)) {
      throw new BadRequestException("Airwallex not available in your country");
    }
    return this.svc.checkoutAirwallex(country, body);
  }
}
```

### Adding a feature gate

1. Add the entry to **both** `apps/web/src/lib/region/features.ts` and
   `apps/server/src/common/region/features.ts`:

   ```ts
   airwallexPay: {
     cells: ["com", "global"],                  // not available in cn
     countries: ["US", "GB", "DE", "FR", ...],  // airwallex-supported only
   },
   ```

2. Call `hasFeature("airwallexPay", country)` at the gate site.

3. Web layer hides UI; server layer 403's the request. **Both** —
   never just web (front-end gates are advisory).

## Cell ≠ Country

The most common confusion: "should EU be its own cell?"

**No.** EU users hit the com cell. GDPR doesn't mandate data
residency for most app data (only "special category" data and certain
flags). For our content + crew use case, Azure Singapore serving
European users is legal. The GDPR cookie banner / privacy notices /
right-to-erasure flows are _country-gated_ features within com —
delivered to EU users only, but powered by the same code and data.

The **only** reason to spin up a new cell is when a hard legal residency
requirement says "this region's data cannot leave this region". Today
that's just China. If we later expand somewhere with the same
constraint (Russia? India under the DPDPA?), we add a cell for that
country and isolate that country's data. Everywhere else stays on com.

## File map

| What                                | Where                                                 |
| ----------------------------------- | ----------------------------------------------------- |
| Web cell constant                   | `apps/web/src/lib/region/cell.ts`                     |
| Web country detection               | `apps/web/src/lib/region/country.ts`                  |
| Web feature matrix                  | `apps/web/src/lib/region/features.ts`                 |
| Web provider + hooks                | `apps/web/src/lib/region/provider.tsx`                |
| Server cell constant                | `apps/server/src/common/region/current-cell.ts`       |
| Server country middleware           | `apps/server/src/common/region/country.middleware.ts` |
| Server `@Country()` decorator       | `apps/server/src/common/region/country.decorator.ts`  |
| Server feature matrix (mirrors web) | `apps/server/src/common/region/features.ts`           |
| Edge header normalization           | `apps/web/proxy.ts` (x-country header)                |
