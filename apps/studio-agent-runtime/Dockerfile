FROM node:22-bookworm-slim AS base

FROM base AS pruner
RUN npm install -g turbo@^2
WORKDIR /app
COPY . .
RUN turbo prune studio-agent-runtime --docker

FROM base AS deps
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN npm ci --ignore-scripts

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/ ./
COPY --from=pruner /app/out/full/ .
RUN npx turbo run build --filter=studio-agent-runtime

FROM base AS runner
LABEL org.opencontainers.image.source=https://github.com/Fizzdragon-Pte-Ltd-2/fizzdragon-platform
WORKDIR /app
ENV NODE_ENV=production
ENV STUDIO_AGENT_HEALTH_PORT=3010

STOPSIGNAL SIGTERM

RUN groupadd --system --gid 1001 studioagent \
  && useradd --system --uid 1001 --gid studioagent studioagent

COPY --from=pruner /app/out/json/ .
RUN npm ci --ignore-scripts --omit=dev
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/studio-agent-runtime/dist ./apps/studio-agent-runtime/dist

USER studioagent
WORKDIR /app/apps/studio-agent-runtime

EXPOSE 3010 9464

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.STUDIO_AGENT_HEALTH_PORT}/ready`).then((response)=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "dist/worker-activities.js"]
