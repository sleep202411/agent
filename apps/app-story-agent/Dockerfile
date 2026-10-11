FROM node:24.18.1-bookworm-slim AS base

FROM base AS pruner
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN npm install -g turbo@2.9.5 --registry="$NPM_REGISTRY"
WORKDIR /app
COPY . .
RUN turbo prune app-story-agent --docker

FROM base AS deps
ARG NPM_REGISTRY=https://registry.npmjs.org
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN npm ci --ignore-scripts --registry="$NPM_REGISTRY"

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/ ./
COPY --from=pruner /app/out/full/ .
# Canonical public copy is a build input, not a dependency on the Web runtime.
COPY --from=pruner /app/apps/web/messages/ ./apps/web/messages/
RUN npx turbo run build --filter=app-story-agent

FROM base AS runner
ARG NPM_REGISTRY=https://registry.npmjs.org
WORKDIR /app
ENV NODE_ENV=production APP_STORY_AGENT_PORT=4397 APP_STORY_AGENT_BIND_ADDRESS=0.0.0.0
STOPSIGNAL SIGTERM
RUN groupadd --system --gid 1001 appstory \
  && useradd --system --uid 1001 --gid appstory appstory
COPY --from=pruner /app/out/json/ .
RUN npm ci --ignore-scripts --omit=dev --registry="$NPM_REGISTRY"
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/app-story-protocol/dist ./packages/app-story-protocol/dist
COPY --from=builder /app/apps/app-story-agent/dist ./apps/app-story-agent/dist
USER appstory
WORKDIR /app/apps/app-story-agent
RUN node --input-type=module -e "await import('app-story-agent/tools')"
EXPOSE 4397
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4397/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
