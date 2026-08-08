FROM node:22-bookworm-slim AS base

FROM base AS pruner
RUN npm install -g turbo@^2
WORKDIR /app
COPY . .
RUN turbo prune agent-os --docker

FROM base AS deps
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN npm ci --ignore-scripts

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/ ./
COPY --from=pruner /app/out/full/ .
RUN npx turbo run build --filter=agent-os

FROM base AS runner
LABEL org.opencontainers.image.source=https://github.com/Fizzdragon-Pte-Ltd-2/fizzdragon-platform
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
RUN npm ci --ignore-scripts --omit=dev

# Every @repo/* dependency is consumed as built dist, and the pruned install
# leaves those directories with a package.json and nothing else.
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/agent-protocol/dist ./packages/agent-protocol/dist
COPY --from=builder /app/packages/agent-policy/dist ./packages/agent-policy/dist
COPY --from=builder /app/packages/agent-tools/dist ./packages/agent-tools/dist
COPY --from=builder /app/packages/agent-skills/dist ./packages/agent-skills/dist
COPY --from=builder /app/packages/model-router/dist ./packages/model-router/dist
COPY --from=builder /app/apps/agent-os/dist ./apps/agent-os/dist

# A workspace dependency added later without a COPY line above would otherwise
# only surface as MODULE_NOT_FOUND when the container boots in production. Fail
# the image build instead.
RUN node -e "\
const {readFileSync,existsSync}=require('node:fs');\
const pkg=JSON.parse(readFileSync('apps/agent-os/package.json','utf8'));\
const missing=Object.keys(pkg.dependencies||{})\
  .filter((name)=>name.startsWith('@repo/'))\
  .map((name)=>'packages/'+name.slice('@repo/'.length))\
  .filter((dir)=>!existsSync(dir+'/dist/index.js'));\
if(missing.length){\
  console.error('Missing built dist for workspace deps: '+missing.join(', '));\
  process.exit(1);\
}\
console.log('workspace dist check: ok');"

USER agentos
WORKDIR /app/apps/agent-os

EXPOSE 4301

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.AGENT_OS_PORT}/health`).then((r)=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

# Not the `start` script: that one reads a local .env file, which does not exist
# in a container — the pod supplies the environment.
CMD ["node", "dist/main.js"]
