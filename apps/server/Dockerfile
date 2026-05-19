FROM node:22-alpine AS base

# ─── Stage 1: Prune monorepo ──────────────────────────────
FROM base AS pruner
RUN npm install -g turbo@^2
WORKDIR /app
COPY . .
RUN turbo prune server --docker

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
RUN npx turbo run build --filter=server

# ─── Stage 4: Runner ────────────────────────────────────
FROM base AS runner
LABEL org.opencontainers.image.source=https://github.com/Fizzdragon-Pte-Ltd-2/fizzdragon-platform
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs

# Re-install production-only deps in workspace layout
COPY --from=pruner /app/out/json/ .
RUN npm ci --ignore-scripts --omit=dev

# Copy @repo/shared's built dist — the node_modules workspace symlink
# points at /app/packages/shared, which was pruned to json-only, so
# without this the server crashes at startup with
# `Cannot find module '@repo/shared/dist/entity-events.js'`.
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist

# Copy Prisma's generated client. `npm ci --ignore-scripts` above skipped
# the @prisma/client postinstall (which is what materializes .prisma/client/),
# so we must lift the generated files from the builder stage where
# `prisma generate` was run as part of the npm build script. Without
# this, the server crashes at startup with
# `Cannot find module '.prisma/client/default'`.
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Copy compiled output
COPY --from=builder /app/apps/server/dist ./apps/server/dist
# Copy Prisma migration assets so production containers can run
# `prisma migrate deploy` before the Nest process starts.
COPY --from=builder /app/apps/server/prisma ./apps/server/prisma
COPY --from=builder /app/apps/server/prisma.config.ts ./apps/server/prisma.config.ts

USER nestjs

WORKDIR /app/apps/server

EXPOSE 3001

CMD ["node", "dist/main.js"]
