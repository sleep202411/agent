# syntax=docker/dockerfile:1
FROM node:24.18.1-alpine AS base

# Prisma's build and runtime stages must resolve the same OpenSSL ABI.
ARG APK_MIRROR=dl-cdn.alpinelinux.org
RUN sed -i "s/dl-cdn.alpinelinux.org/${APK_MIRROR}/g" /etc/apk/repositories && \
    apk add --no-cache openssl

# ─── Stage 1: Prune monorepo ──────────────────────────────
FROM base AS pruner
ARG NPM_REGISTRY=https://registry.npmjs.org
# Pin turbo: floating ^2 once pulled 2.10.x in ACR and made prune harder to reason about.
RUN npm install -g turbo@2.9.5 --registry="$NPM_REGISTRY"
WORKDIR /app
COPY . .
RUN turbo prune server --docker

# ─── Stage 2: Install dependencies ───────────────────────
FROM base AS deps
ARG NPM_REGISTRY=https://registry.npmjs.org
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN npm ci --ignore-scripts --registry="$NPM_REGISTRY"

# ─── Stage 3: Build ──────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/ ./
COPY --from=pruner /app/out/full/ .
# Pin the heap instead of letting V8 size it from the host's memory. The build
# build cgroup limit is lower than what Node detects, so tsc can grow past it
# and get SIGKILLed (exit 137). A fixed ceiling makes the build predictable.
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN node apps/server/scripts/prisma-engine.cjs prepare
ENV PRISMA_SCHEMA_ENGINE_BINARY=/opt/prisma/schema-engine
RUN npx turbo run build --filter=server

# ─── Stage 4: Runner ────────────────────────────────────
FROM base AS runner
LABEL org.opencontainers.image.source=https://github.com/Fizzdragon-Pte-Ltd-2/fizzdragon-platform
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV PRISMA_SCHEMA_ENGINE_BINARY=/opt/prisma/schema-engine

RUN apk add --no-cache ffmpeg && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs

# Re-install production-only deps in workspace layout
ARG NPM_REGISTRY=https://registry.npmjs.org
COPY --from=pruner /app/out/json/ .
RUN npm ci --ignore-scripts --omit=dev --registry="$NPM_REGISTRY"

# Copy every workspace package's built dist — the node_modules symlinks point
# at /app/packages/*, which turbo pruned to json-only, so without these the
# server crashes at startup with `Cannot find module '@repo/…'`. The imports are
# static and evaluated at module load, so a missing one crashes the whole API
# tier even when the feature it belongs to is disabled by flag.
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/game-agent-protocol/dist ./packages/game-agent-protocol/dist
COPY --from=builder /app/packages/agent-skills/dist ./packages/agent-skills/dist
COPY --from=builder /app/packages/agent-capabilities/dist ./packages/agent-capabilities/dist
COPY --from=builder /app/packages/agent-tools/dist ./packages/agent-tools/dist
COPY --from=builder /app/packages/agent-protocol/dist ./packages/agent-protocol/dist

# Copy Prisma's generated client. `npm ci --ignore-scripts` above skipped
# the @prisma/client postinstall (which is what materializes .prisma/client/),
# so we must lift the generated files from the builder stage where
# `prisma generate` was run as part of the npm build script. Without
# this, the server crashes at startup with
# `Cannot find module '.prisma/client/default'`.
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Keep the locked native migration engine in the image. Runtime CLI commands
# use this fixed path instead of attempting a download during deployment.
COPY --from=builder /opt/prisma /opt/prisma
COPY --from=builder /app/apps/server/scripts/prisma-engine.cjs ./apps/server/scripts/prisma-engine.cjs

# Copy compiled output
COPY --from=builder /app/apps/server/dist ./apps/server/dist
# Copy Prisma migration assets so production containers can run
# `prisma migrate deploy` before the Nest process starts.
COPY --from=builder /app/apps/server/prisma ./apps/server/prisma
COPY --from=builder /app/apps/server/prisma.config.ts ./apps/server/prisma.config.ts

# A migration directory without its `migration.sql` aborts `migrate deploy`
# with P3015 — every pod then dies in the db-migrate init container while the
# old ones keep serving, so the rollout silently stalls instead of failing
# loudly. Git cannot track an empty directory, so a cancelled `migrate dev`
# leaves one behind invisibly and the build context ships it anyway. Fail here,
# where the message is obvious, rather than at 3am in a half-rolled deploy.
RUN node -e "\
const {readdirSync,existsSync}=require('node:fs');\
const root='apps/server/prisma/migrations';\
const broken=readdirSync(root,{withFileTypes:true})\
  .filter((e)=>e.isDirectory())\
  .map((e)=>root+'/'+e.name)\
  .filter((dir)=>!existsSync(dir+'/migration.sql'));\
if(broken.length){\
  console.error('Migration directories missing migration.sql: '+broken.join(', '));\
  process.exit(1);\
}console.log('migration integrity check: ok');"

# Keep generated/client assets writable by the unprivileged runtime user.
# The fixed migration engine remains root-owned and read-only.
RUN chown -R nestjs:nodejs \
    /app/node_modules/@prisma \
    /app/node_modules/.prisma \
    /app/apps/server/prisma \
    /app/apps/server/prisma.config.ts

USER nestjs

# Verify the scoped catalog updater works with production-only dependencies and
# compiled files. Dry-run constructs a plan without opening a DB connection.
RUN node apps/server/dist/catalog-update/prisma/seed/update-model-catalog.js --dry-run gpt-image-2 > /dev/null

# Validate package metadata, entry points and transitive imports as the same
# unprivileged user that runs the service. A root-only file-existence check
# misses unreadable package.json files and broken workspace links.
RUN node --input-type=module -e "\
import {readFileSync} from 'node:fs';\
const pkg=JSON.parse(readFileSync('apps/server/package.json','utf8'));\
const names=Object.keys(pkg.dependencies||{}).filter(name=>name.startsWith('@repo/'));\
await Promise.all(names.map(name=>import(name)));\
console.log('workspace runtime imports: ok');"

WORKDIR /app/apps/server

# These commands inspect local tooling only; neither opens a database. Running
# them offline as nestjs catches missing engines, wrong ABI and permissions.
RUN --network=none node scripts/prisma-engine.cjs verify && \
    CHECKPOINT_DISABLE=1 DOTENV_CONFIG_PATH=/dev/null DATABASE_URL= \
      node /app/node_modules/prisma/build/index.js --version && \
    CHECKPOINT_DISABLE=1 DOTENV_CONFIG_PATH=/dev/null DATABASE_URL= \
      node /app/node_modules/prisma/build/index.js migrate status --help

EXPOSE 3001

CMD ["node", "dist/main.js"]
