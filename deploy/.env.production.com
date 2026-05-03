# ⚠️ Do not put infrastructure secrets here (DB / OSS-write / JWT / cloud SDK keys) — use 1Password/Vault for those.
# ============ Production COM (fizzstudio.fizzdragon.com) ============
COMPOSE_PROJECT_NAME=production-com
WEB_IMAGE=ghcr.io/fizzdragon-pte-ltd-2/studio-web:production-com
SERVER_IMAGE=ghcr.io/fizzdragon-pte-ltd-2/studio-server:production-com
AGENT_IMAGE=ghcr.io/fizzdragon-pte-ltd-2/studio-agent:production-com
WEB_PORT=3000
SERVER_PORT=3001

# Server env
JAVA_STUDIO_URL=https://fizzdragon.com/studio
JAVA_CONTENT_URL=https://fizzdragon.com/content
# --- DeepSeek (active — same config as staging, proven end-to-end) ---
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=sk-1abd1c91f73347d0be88f93ea7d079fa
AI_MODEL=deepseek-chat
STORYOS_ROUTER_PROVIDER=deepseek
STORYOS_PERSONA_PROVIDER=deepseek
# --- Alibaba (kept commented — hit 400 "content required" on compat endpoint) ---
ALIBABA_API_KEY=sk-0484a407126d4f50adaed6a6762b30ca
ALIBABA_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1

# Worker parallelism — bumped to 90 for 8c/16g ECS (ecs.c8i.2xlarge).
# Workflows are I/O-bound (LLM + Java) so the real ceiling is DeepSeek
# backend latency, not local CPU. DeepSeek doesn't rate-limit but shared
# service latency expands under load, so we shrink the inner
# storyboard-phase fan-out to 2 — keeps peak concurrent LLM requests to
# ~180 (90 × 2) instead of ~540 (90 × 6). Image worker stays at 1 to
# respect Replicate / Java image-queue's own throttling.
WORKER_CONCURRENCY=90
STORYBOARD_GENERATE_CONCURRENCY=2
IMAGE_WORKER_CONCURRENCY=1

DISABLE_CONTENT_MODERATION=true
