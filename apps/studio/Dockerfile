FROM node:24.18.1-alpine AS base

# ─── Stage 1: Install + build (full monorepo) ─────────────
# Deliberately NOT turbo-pruned: pruning rewrites the lockfile layout
# (hoists studio's nested next/tailwind to the root) and Next 16's Turbopack
# then fails resolving its own dist + the tailwind v4 postcss plugin
# ("default-transpiled-packages.json not found" / "no valid target file").
# Installing the full lockfile reproduces the exact local layout the build is
# verified against; the runner stage still ships only the standalone output,
# so the final image size is unaffected.
FROM base AS builder
ARG NPM_REGISTRY=https://registry.npmjs.org
WORKDIR /app
COPY . .
RUN rm -f apps/studio/.env.local apps/studio/.env.development.local apps/studio/.env.production.local
RUN npm ci --ignore-scripts --registry="$NPM_REGISTRY"

# Java backend URLs are baked into the Next.js rewrite table at BUILD time
# (next.config.ts rewrites → routes-manifest). A runtime-only env is IGNORED by
# the compiled rewrites, so these MUST be passed as build args. When missing,
# next.config falls back to the .com host — which silently forwards a non-.com
# cell's /user/* (auth) + /api/* to the wrong (intl) Java. Pass per-cell.
# Developer-local Next env files are removed above so localhost WS/auth values
# cannot be baked into the standalone server or client bundle.
# NEXT_PUBLIC_SITE_REGION is inlined into the CLIENT bundle at build; SITE_REGION
# drives which host studio links out to for register / forgot-password / legal
# pages (web-base.ts) — missing → defaults to `global` → .com links on the .cn cell.
ARG AURORA_PROXY_TARGET
ARG AURORA_STRIP_PREFIX
ARG JAVA_STUDIO_URL
ARG JAVA_CONTENT_URL
ARG NEXT_PUBLIC_SITE_REGION
# Write .env.production so Next loads them at build. Turbo's strict env-mode
# strips undeclared process env from tasks (so a plain ENV is invisible to
# `next build`), but Next reads .env files directly — same mechanism apps/web
# uses. NEXT_PUBLIC_* gets inlined into the client bundle here.
RUN printf "AURORA_PROXY_TARGET=%s\nAURORA_STRIP_PREFIX=%s\nJAVA_STUDIO_URL=%s\nJAVA_CONTENT_URL=%s\nNEXT_PUBLIC_SITE_REGION=%s\n" \
  "$AURORA_PROXY_TARGET" "$AURORA_STRIP_PREFIX" "$JAVA_STUDIO_URL" "$JAVA_CONTENT_URL" "$NEXT_PUBLIC_SITE_REGION" \
  > apps/studio/.env.production
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN npx turbo run build --filter=studio

# ─── Stage 2: Runner ────────────────────────────────────
FROM base AS runner
LABEL org.opencontainers.image.source=https://github.com/Fizzdragon-Pte-Ltd-2/fizzdragon-platform
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 appuser

# Next.js standalone output
COPY --from=builder --chown=appuser:nodejs /app/apps/studio/.next/standalone ./
COPY --from=builder --chown=appuser:nodejs /app/apps/studio/.next/static ./apps/studio/.next/static
COPY --from=builder --chown=appuser:nodejs /app/apps/studio/public ./apps/studio/public

USER appuser

EXPOSE 3000

CMD ["node", "apps/studio/server.js"]
