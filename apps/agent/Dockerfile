FROM node:22-alpine AS base

# ─── Stage 1: Prune monorepo ──────────────────────────────
FROM base AS pruner
RUN npm install -g turbo@^2
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
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN npm ci --ignore-scripts

# ─── Stage 3: Build ──────────────────────────────────────
# Produces apps/agent/.mastra/output (a hono-based server bundle that
# `mastra start` consumes). Doesn't touch src/ — the worker runs that
# directly via tsx in the runner stage.
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/ ./
COPY --from=pruner /app/out/full/ .
WORKDIR /app/apps/agent
RUN npx mastra build

# ─── Stage 4: Runner ────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4111
ENV MASTRA_HOST=0.0.0.0
# libsql state lives in a mounted volume so API + worker can share it and
# in-flight workflow snapshots survive container restarts.
ENV MASTRA_DB_URL=file:/app/data/mastra.db

# Re-install deps (keeps mastra CLI + tsx available at runtime)
COPY --from=pruner /app/out/json/ .
RUN npm ci --ignore-scripts

# API server consumes .mastra/output; worker imports from src/. Ship both.
COPY --from=builder /app/apps/agent/.mastra ./apps/agent/.mastra
COPY --from=builder /app/apps/agent/src ./apps/agent/src

RUN mkdir -p /app/data

WORKDIR /app/apps/agent

EXPOSE 4111

# Default: API server. The agent-worker compose service overrides command
# to `npx tsx src/worker.ts` so a single image runs both processes.
CMD ["npx", "mastra", "start"]
