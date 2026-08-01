# syntax=docker/dockerfile:1.7

FROM node:24.18.0-bookworm-slim AS builder

WORKDIR /build
RUN npm install --global npm@11.16.0

COPY apps/agent-platform/package.json apps/agent-platform/package-lock.json ./
# Plain RUN: `az acr build` uses the classic builder, which rejects BuildKit
# cache mounts. The mount was only an npm cache optimization.
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY apps/agent-platform/ ./
RUN npm run build

FROM node:24.18.0-bookworm-slim AS runtime

LABEL org.opencontainers.image.source="https://github.com/Fizzdragon-Pte-Ltd-2/fizzdragon-platform"

ENV NODE_ENV=production
RUN apt-get update \
    && apt-get install --yes --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 agentplatform \
    && useradd --system --uid 1001 --gid agentplatform --home-dir /nonexistent agentplatform

ENTRYPOINT ["/usr/bin/tini", "--"]
STOPSIGNAL SIGTERM

FROM runtime AS api

WORKDIR /opt/fizzdragon/agent-platform
ENV PORT=4111
ENV MASTRA_TELEMETRY_DISABLED=1

COPY --from=builder --chown=agentplatform:agentplatform /build/.mastra/output/ ./

USER agentplatform
EXPOSE 4111
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/api/v1/health/live`).then((response)=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "index.mjs"]

FROM runtime AS worker

WORKDIR /opt/fizzdragon/agent-platform
ENV MASTRA_TELEMETRY_DISABLED=1
ENV AGENT_WORKER_HEALTH_HOST=0.0.0.0
ENV AGENT_WORKER_HEALTH_PORT=3010
ENV AGENT_WORKER_METRICS_BIND_ADDRESS=0.0.0.0:9464

COPY --from=builder --chown=agentplatform:agentplatform /build/.temporal/worker/ ./

USER agentplatform
EXPOSE 3010 9464
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.AGENT_WORKER_HEALTH_PORT}/health/live`).then((response)=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/src/runtime/worker.js"]

FROM runtime AS migrator

WORKDIR /opt/fizzdragon/agent-platform
COPY --from=builder --chown=agentplatform:agentplatform /build/.migrations/agent-memory/ ./

USER agentplatform
CMD ["node", "dist/migrate-memory.js"]
