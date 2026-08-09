FROM node:22-alpine AS base

# ─── Stage 1: Prune monorepo ──────────────────────────────
FROM base AS pruner
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN npm install -g turbo@^2 --registry="$NPM_REGISTRY"
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
RUN npx turbo run build --filter=server

# ─── Stage 4: Runner ────────────────────────────────────
FROM base AS runner
LABEL org.opencontainers.image.source=https://github.com/Fizzdragon-Pte-Ltd-2/fizzdragon-platform
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

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
COPY --from=builder /app/packages/agent-skills/dist ./packages/agent-skills/dist
COPY --from=builder /app/packages/agent-capabilities/dist ./packages/agent-capabilities/dist
COPY --from=builder /app/packages/agent-tools/dist ./packages/agent-tools/dist

# A workspace dependency added later without a COPY line above would otherwise
# only surface as MODULE_NOT_FOUND when the container boots in production —
# which is exactly how @repo/agent-skills got missed. Fail the image build.
RUN node -e "\
const {readFileSync,existsSync}=require('node:fs');\
const pkg=JSON.parse(readFileSync('apps/server/package.json','utf8'));\
const missing=Object.keys(pkg.dependencies||{})\
  .filter((name)=>name.startsWith('@repo/'))\
  .map((name)=>'packages/'+name.slice('@repo/'.length))\
  .filter((dir)=>!existsSync(dir+'/dist/index.js'));\
if(missing.length){\
  console.error('Missing built dist for workspace deps: '+missing.join(', '));\
  process.exit(1);\
}\
console.log('workspace dist check: ok');"

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

# Prisma CLI may refresh engine files during `migrate deploy`. The
# container runs as the unprivileged `nestjs` user, so keep Prisma-owned
# runtime assets writable by that user instead of failing at startup.
RUN chown -R nestjs:nodejs \
    /app/node_modules/@prisma \
    /app/node_modules/.prisma \
    /app/apps/server/prisma \
    /app/apps/server/prisma.config.ts

USER nestjs

WORKDIR /app/apps/server

EXPOSE 3001

CMD ["node", "dist/main.js"]
