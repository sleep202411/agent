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
