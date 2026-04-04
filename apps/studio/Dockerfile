# ─── Stage 1: Dependencies ──────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# ─── Stage 2: Build ─────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time env vars (NEXT_PUBLIC_*) are baked into the bundle.
# Pass them via --build-arg in CI.
ARG NEXT_PUBLIC_OSS_BASE_URL
ENV NEXT_PUBLIC_OSS_BASE_URL=$NEXT_PUBLIC_OSS_BASE_URL

ARG JAVA_STUDIO_URL
ENV JAVA_STUDIO_URL=$JAVA_STUDIO_URL

ARG JAVA_CONTENT_URL
ENV JAVA_CONTENT_URL=$JAVA_CONTENT_URL

RUN npm run build

# ─── Stage 3: Runner ────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Don't run as root
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone output + static assets
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
