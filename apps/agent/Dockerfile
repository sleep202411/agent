FROM node:22-alpine AS base

# ─── Stage 1: Prune monorepo ──────────────────────────────
FROM base AS pruner
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN npm install -g turbo@^2 --registry="$NPM_REGISTRY"
WORKDIR /app
COPY . .
RUN turbo prune agent --docker

# ─── Stage 2: Install dependencies ───────────────────────
# Mastra's CLI (`mastra start`) and tsx (worker runtime) live in devDependencies.
# Both are needed at container start, so we DON'T use --omit=dev here or in the
# runner stage. The tradeoff is a larger image; compared to simpler alternatives
# (moving tsx/mastra to deps, or shipping pre-bundled JS for the worker) this
# keeps package.json honest about what's a build-time tool vs what ships to prod.
FROM base AS deps
ARG NPM_REGISTRY=https://registry.npmjs.org
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN npm ci --ignore-scripts --registry="$NPM_REGISTRY"

# ─── Stage 3: Build ──────────────────────────────────────
# Produces apps/agent/.mastra/output (hono-based server bundle that
# `mastra start` consumes) AND packages/shared/dist (compiled TS the
# worker imports at runtime). Uses `turbo run build --filter=agent`
# instead of bare `mastra build` so turbo's `dependsOn: ["^build"]`
# chain runs `@repo/shared`'s build first — otherwise tsx crashes at
# worker startup trying to resolve `@repo/shared/dist/workflow.js`.
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/ ./
COPY --from=pruner /app/out/full/ .
RUN npx turbo run build --filter=agent

# ─── Stage 4: Runner ────────────────────────────────────
FROM base AS runner
LABEL org.opencontainers.image.source=https://github.com/Fizzdragon-Pte-Ltd-2/fizzdragon-platform
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4111
ENV MASTRA_HOST=0.0.0.0
# Agent storage is Postgres-backed (`DATABASE_URL`, schema `mastra`).
# CN compose sets PGSSLMODE=disable for in-docker PG; managed PG deploys
# keep the default TLS mode from apps/agent/src/mastra/lib/postgres-config.ts.

# Re-install deps (keeps mastra CLI + tsx available at runtime). NODE_ENV is
# already production here, so explicitly include dev deps; otherwise npm omits
# `mastra` and `tsx`, and `npx` tries to download them at container start.
ARG NPM_REGISTRY=https://registry.npmjs.org
COPY --from=pruner /app/out/json/ .
RUN npm ci --ignore-scripts --include=dev --registry="$NPM_REGISTRY"

# API server consumes .mastra/output; worker imports from src/ and resolves
# `@repo/shared` to its built dist/. Ship all three.
COPY --from=builder /app/apps/agent/.mastra ./apps/agent/.mastra
COPY --from=builder /app/apps/agent/src ./apps/agent/src
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist

WORKDIR /app/apps/agent

EXPOSE 4111

# Default: API server. The agent-worker compose service overrides command
# to `npx tsx src/worker.ts` so a single image runs both processes.
CMD ["npx", "mastra", "start"]
