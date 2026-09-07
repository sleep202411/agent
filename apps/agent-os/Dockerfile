FROM node:24.18.1-bookworm-slim AS base

FROM base AS pruner
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN npm install -g turbo@^2 --registry="$NPM_REGISTRY"
WORKDIR /app
COPY . .
RUN turbo prune agent-os --docker

FROM base AS deps
ARG NPM_REGISTRY=https://registry.npmjs.org
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN npm ci --ignore-scripts --registry="$NPM_REGISTRY"

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/ ./
COPY --from=pruner /app/out/full/ .
RUN npx turbo run build --filter=agent-os

FROM base AS runner
LABEL org.opencontainers.image.source=https://github.com/Fizzdragon-Pte-Ltd-2/fizzdragon-platform
ARG NPM_REGISTRY=https://registry.npmjs.org
WORKDIR /app
ENV NODE_ENV=production
ENV AGENT_OS_PORT=4301
# The gateway runs in a different pod, so loopback (the code's default, which is
# right on a developer host) would make this unreachable. Exposure is contained
# by the internal token every /v1 route checks, plus a network policy.
ENV AGENT_OS_BIND_ADDRESS=0.0.0.0

STOPSIGNAL SIGTERM

RUN groupadd --system --gid 1001 agentos \
  && useradd --system --uid 1001 --gid agentos agentos

COPY --from=pruner /app/out/json/ .
RUN npm ci --ignore-scripts --omit=dev --registry="$NPM_REGISTRY"

# Every @repo/* dependency is consumed as built dist, and the pruned install
# leaves those directories with a package.json and nothing else.
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/agent-protocol/dist ./packages/agent-protocol/dist
COPY --from=builder /app/packages/agent-policy/dist ./packages/agent-policy/dist
COPY --from=builder /app/packages/agent-tools/dist ./packages/agent-tools/dist
COPY --from=builder /app/packages/agent-skills/dist ./packages/agent-skills/dist
COPY --from=builder /app/packages/model-router/dist ./packages/model-router/dist
COPY --from=builder /app/packages/agent-capabilities/dist ./packages/agent-capabilities/dist
COPY --from=builder /app/apps/agent-os/dist ./apps/agent-os/dist

USER agentos

# Validate package metadata, entry points and transitive imports as the same
# unprivileged user that runs the service. A root-only file-existence check
# misses unreadable package.json files and broken workspace links.
RUN node --input-type=module -e "\
import {readFileSync} from 'node:fs';\
const pkg=JSON.parse(readFileSync('apps/agent-os/package.json','utf8'));\
const names=Object.keys(pkg.dependencies||{}).filter(name=>name.startsWith('@repo/'));\
await Promise.all(names.map(name=>import(name)));\
console.log('workspace runtime imports: ok');"

WORKDIR /app/apps/agent-os

EXPOSE 4301

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.AGENT_OS_PORT}/health`).then((r)=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

# Not the `start` script: that one reads a local .env file, which does not exist
# in a container — the pod supplies the environment.
CMD ["node", "dist/main.js"]
