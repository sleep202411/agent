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

# Vite env vars (VITE_ prefix, baked into client bundle at build time)
ARG VITE_OSS_BASE_URL
ENV VITE_OSS_BASE_URL=$VITE_OSS_BASE_URL

ARG VITE_SITE_REGION
ENV VITE_SITE_REGION=$VITE_SITE_REGION

ARG VITE_PARENT_ORIGIN
ENV VITE_PARENT_ORIGIN=$VITE_PARENT_ORIGIN

# Server-only env vars (used by vite.config proxy, not baked into client)
ARG SERVER_URL
ENV SERVER_URL=$SERVER_URL

ARG JAVA_STUDIO_URL
ENV JAVA_STUDIO_URL=$JAVA_STUDIO_URL

ARG JAVA_CONTENT_URL
ENV JAVA_CONTENT_URL=$JAVA_CONTENT_URL

ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN npx turbo run build --filter=web

# ─── Stage 4: Runner ────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 appuser

# Nitro build output (self-contained, no node_modules needed)
COPY --from=builder --chown=appuser:nodejs /app/apps/web/.output ./.output

USER appuser

EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
