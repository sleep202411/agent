FROM node:22-alpine AS base

# ─── Stage 1: Prune monorepo ──────────────────────────────
FROM base AS pruner
RUN npm install -g turbo@^2
WORKDIR /app
COPY . .
RUN turbo prune web --docker

# ─── Stage 2: Install dependencies ───────────────────────
FROM base AS deps
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN npm ci --ignore-scripts

# ─── Stage 3: Build ──────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/ ./
COPY --from=pruner /app/out/full/ .

# Build args
ARG NEXT_PUBLIC_OSS_BASE_URL
ARG NEXT_PUBLIC_BANNER_BASE_URL
ARG NEXT_PUBLIC_USER_BASE_URL
ARG NEXT_PUBLIC_SITE_REGION
ARG NEXT_PUBLIC_PARENT_ORIGIN
ARG NEXT_PUBLIC_WS_HOST
ARG NEXT_PUBLIC_API_CONTENT_PREFIX
ARG NEXT_PUBLIC_API_STUDIO_PREFIX
ARG SERVER_URL
ARG JAVA_STUDIO_URL
ARG JAVA_CONTENT_URL

# Write .env.production for Next.js to pick up at build time (NEXT_PUBLIC_* gets inlined)
RUN printf "NEXT_PUBLIC_OSS_BASE_URL=%s\nNEXT_PUBLIC_BANNER_BASE_URL=%s\nNEXT_PUBLIC_USER_BASE_URL=%s\nNEXT_PUBLIC_SITE_REGION=%s\nNEXT_PUBLIC_PARENT_ORIGIN=%s\nNEXT_PUBLIC_WS_HOST=%s\nNEXT_PUBLIC_API_CONTENT_PREFIX=%s\nNEXT_PUBLIC_API_STUDIO_PREFIX=%s\nSERVER_URL=%s\nJAVA_STUDIO_URL=%s\nJAVA_CONTENT_URL=%s\n" \
  "$NEXT_PUBLIC_OSS_BASE_URL" "$NEXT_PUBLIC_BANNER_BASE_URL" "$NEXT_PUBLIC_USER_BASE_URL" \
  "$NEXT_PUBLIC_SITE_REGION" "$NEXT_PUBLIC_PARENT_ORIGIN" "$NEXT_PUBLIC_WS_HOST" \
  "$NEXT_PUBLIC_API_CONTENT_PREFIX" "$NEXT_PUBLIC_API_STUDIO_PREFIX" \
  "$SERVER_URL" "$JAVA_STUDIO_URL" "$JAVA_CONTENT_URL" \
  > apps/web/.env.production

ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN npx turbo run build --filter=web

# ─── Stage 4: Runner ────────────────────────────────────
FROM base AS runner
LABEL org.opencontainers.image.source=https://github.com/Fizzdragon-Pte-Ltd-2/fizzdragon-platform
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 appuser

# Next.js standalone output
COPY --from=builder --chown=appuser:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=appuser:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=appuser:nodejs /app/apps/web/public ./apps/web/public

USER appuser

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
