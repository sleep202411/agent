FROM node:24.18.1-bookworm-slim AS base

FROM base AS pruner
ARG NPM_REGISTRY=https://registry.npmjs.org
RUN npm install -g turbo@2.9.5 --registry="$NPM_REGISTRY"
WORKDIR /app
COPY . .
RUN turbo prune game-agent --docker

FROM base AS deps
ARG NPM_REGISTRY=https://registry.npmjs.org
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN npm ci --ignore-scripts --registry="$NPM_REGISTRY"

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/ ./
COPY --from=pruner /app/out/full/ .
RUN npx turbo run build --filter=game-agent

FROM base AS runner
ARG NPM_REGISTRY=https://registry.npmjs.org
WORKDIR /app
ENV NODE_ENV=production
ENV GAME_AGENT_PORT=4396
ENV GAME_AGENT_BIND_ADDRESS=0.0.0.0
STOPSIGNAL SIGTERM

RUN groupadd --system --gid 1001 gameagent \
  && useradd --system --uid 1001 --gid gameagent gameagent \
  && install -d -m 0700 -o gameagent -g gameagent /var/lib/game-agent/workspaces
COPY --from=pruner /app/out/json/ .
RUN npm ci --ignore-scripts --omit=dev --registry="$NPM_REGISTRY"
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/game-ui-build/dist ./packages/game-ui-build/dist
COPY --from=builder /app/packages/game-agent-protocol/dist ./packages/game-agent-protocol/dist
COPY --from=builder /app/packages/appearance-harness-ui/index.js ./packages/appearance-harness-ui/index.js
COPY --from=builder /app/packages/appearance-harness-ui/client.js ./packages/appearance-harness-ui/client.js
COPY --from=builder /app/apps/game-agent/dist ./apps/game-agent/dist

USER gameagent
WORKDIR /app/apps/game-agent
RUN node --input-type=module -e "\
await import('game-agent/appearance-harness-plugin');\
const {buildGameUI}=await import('@repo/game-ui-build');\
await buildGameUI({apiVersion:1,surface:'main-menu',entry:'menu.js',files:[{path:'menu.js',content:'export function mount() {}'}]});\
console.log('Game Agent runtime imports and compiler: ok');"

EXPOSE 4396
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.GAME_AGENT_PORT}/health`).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
