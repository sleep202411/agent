# ⚠️ Do not put infrastructure secrets here (DB / OSS-write / JWT / cloud SDK keys) — use 1Password/Vault for those.
# ============ 生产环境 - COM ============
# studio.fizzdragon.com

# ============ Java Backend ============
JAVA_CONTENT_URL=https://fizzdragon.com/content
JAVA_STUDIO_URL=https://fizzdragon.com/studio

# ============ NestJS Server ============
SERVER_URL=http://localhost:3001

# ============ Site Region ============
NEXT_PUBLIC_SITE_REGION=global

# ============ OSS ============
NEXT_PUBLIC_OSS_BASE_URL=https://fizzstudio-sg.oss-ap-southeast-1.aliyuncs.com
NEXT_PUBLIC_USER_BASE_URL=https://user-aratar-sg.oss-ap-southeast-1.aliyuncs.com
NEXT_PUBLIC_BANNER_BASE_URL=https://fizzdragon-banner-sg.oss-ap-southeast-1.aliyuncs.com
NEXT_PUBLIC_PARENT_ORIGIN=https://fizzdragon.com

NEXT_PUBLIC_API_CONTENT_PREFIX=/content
NEXT_PUBLIC_API_STUDIO_PREFIX=/studio

# ============ PostHog (analytics — inlined at build time) ============
# Token is the public Project API Key (`phc_…`) — safe to embed in
# client JS; it can only write events, never read. Browser sends events
# to `/ingest/*` which nginx rewrites to PostHog (see next.config.ts
# beforeFiles + skipTrailingSlashRedirect). To split prod-cn / prod-com
# event streams later, create separate PostHog projects and swap the
# token here without touching code.
NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=phc_uLyf9JuzSEg9iu4aMtFQDBHYfQB5LZDU5wjP5JoivfBQ
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
