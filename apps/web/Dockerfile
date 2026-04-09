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

ARG NEXT_PUBLIC_OSS_BASE_URL
ENV NEXT_PUBLIC_OSS_BASE_URL=$NEXT_PUBLIC_OSS_BASE_URL

ARG SERVER_URL
ENV SERVER_URL=$SERVER_URL

ARG JAVA_STUDIO_URL
ENV JAVA_STUDIO_URL=$JAVA_STUDIO_URL

ARG JAVA_CONTENT_URL
ENV JAVA_CONTENT_URL=$JAVA_CONTENT_URL

ARG NEXT_PUBLIC_SITE_REGION
ENV NEXT_PUBLIC_SITE_REGION=$NEXT_PUBLIC_SITE_REGION

ARG NEXT_PUBLIC_PARENT_ORIGIN
ENV NEXT_PUBLIC_PARENT_ORIGIN=$NEXT_PUBLIC_PARENT_ORIGIN

# Next.js 16 (Turbopack) reads env from .env files, not process.env
RUN echo "NEXT_PUBLIC_OSS_BASE_URL=$NEXT_PUBLIC_OSS_BASE_URL" > apps/web/.env.local && \
    echo "NEXT_PUBLIC_SITE_REGION=$NEXT_PUBLIC_SITE_REGION" >> apps/web/.env.local && \
    echo "NEXT_PUBLIC_PARENT_ORIGIN=$NEXT_PUBLIC_PARENT_ORIGIN" >> apps/web/.env.local && \
    echo "SERVER_URL=$SERVER_URL" >> apps/web/.env.local && \
    echo "JAVA_STUDIO_URL=$JAVA_STUDIO_URL" >> apps/web/.env.local && \
    echo "JAVA_CONTENT_URL=$JAVA_CONTENT_URL" >> apps/web/.env.local

RUN npx turbo run build --filter=web

# ─── Stage 4: Runner ────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

ARG SERVER_URL
ENV SERVER_URL=$SERVER_URL
ARG JAVA_STUDIO_URL
ENV JAVA_STUDIO_URL=$JAVA_STUDIO_URL
ARG JAVA_CONTENT_URL
ENV JAVA_CONTENT_URL=$JAVA_CONTENT_URL

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Next.js standalone output in monorepo preserves the apps/web/ path
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

USER nextjs

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
