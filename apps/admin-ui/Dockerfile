FROM node:24.18.1-alpine AS base

# ─── Stage 1: Install + build (full monorepo) ─────────────
# Deliberately NOT turbo-pruned: pruning rewrites the lockfile layout and the
# tailwind v4 / Next resolution then breaks ("no valid target file" /
# "default-transpiled-packages.json not found") — see apps/studio/Dockerfile.
# The runner ships only the standalone output, so image size is unaffected.
FROM base AS builder
ARG NPM_REGISTRY=https://registry.npmjs.org
WORKDIR /app
COPY . .
RUN npm ci --ignore-scripts --registry="$NPM_REGISTRY"

ARG NEXT_PUBLIC_ADMIN_UI_BASE_PATH
ARG ADMIN_GLOBAL_API_BASE_URL=http://fizzdragon-server:3001/admin
ARG ADMIN_API_BASE_URL=http://fizzdragon-server:3001/admin
# Regional banner OSS public origin — baked into client for course cover previews.
# CN temporarily shares the .com SG bucket for preview.
ARG NEXT_PUBLIC_BANNER_BASE_URL=https://fizzdragon-banner-sg.oss-ap-southeast-1.aliyuncs.com
ENV NEXT_PUBLIC_ADMIN_UI_BASE_PATH=$NEXT_PUBLIC_ADMIN_UI_BASE_PATH
ENV ADMIN_GLOBAL_API_BASE_URL=$ADMIN_GLOBAL_API_BASE_URL
ENV ADMIN_API_BASE_URL=$ADMIN_API_BASE_URL
ENV NEXT_PUBLIC_BANNER_BASE_URL=$NEXT_PUBLIC_BANNER_BASE_URL
ENV NEXT_TELEMETRY_DISABLED=1
ENV TURBO_TELEMETRY_DISABLED=1

RUN mkdir -p apps/admin-ui/node_modules && \
    rm -rf apps/admin-ui/node_modules/next && \
    ln -s ../../../node_modules/next apps/admin-ui/node_modules/next && \
    rm -rf apps/admin-ui/node_modules/typescript && \
    ln -s ../../../node_modules/typescript apps/admin-ui/node_modules/typescript && \
    mkdir -p apps/admin-ui/node_modules/@types && \
    rm -rf apps/admin-ui/node_modules/@types/node && \
    ln -s ../../../../node_modules/@types/node apps/admin-ui/node_modules/@types/node && \
    test -f apps/admin-ui/node_modules/next/dist/lib/default-transpiled-packages.json && \
    test -f apps/admin-ui/node_modules/typescript/lib/typescript.js && \
    test -f apps/admin-ui/node_modules/@types/node/index.d.ts
RUN npx turbo run build --filter=admin-ui

# ─── Stage 4: Runner ────────────────────────────────────
FROM base AS runner
LABEL org.opencontainers.image.source=https://github.com/Fizzdragon-Pte-Ltd-2/fizzdragon-platform
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 appuser

COPY --from=builder --chown=appuser:nodejs /app/apps/admin-ui/.next/standalone ./
COPY --from=builder --chown=appuser:nodejs /app/apps/admin-ui/.next/static ./apps/admin-ui/.next/static
COPY --from=builder --chown=appuser:nodejs /app/apps/admin-ui/public ./apps/admin-ui/public
# Belt-and-suspenders: standalone tracing can drop css-tree/data/*.json
# (SSR: Cannot find module '../data/patch.json').
COPY --from=builder --chown=appuser:nodejs /app/node_modules/css-tree/data ./node_modules/css-tree/data
# Next standalone file tracing can omit css-tree JSON data (MODULE_NOT_FOUND
# ../data/patch.json) while still shipping lib/data-patch.js — copy explicitly.
COPY --from=builder --chown=appuser:nodejs /app/node_modules/css-tree/data ./node_modules/css-tree/data

USER appuser

EXPOSE 3000

CMD ["node", "apps/admin-ui/server.js"]
