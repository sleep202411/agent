# ⚠️ Do not put infrastructure secrets here (DB / OSS-write / JWT / cloud SDK keys) — use 1Password/Vault for those.
# ============ 生产环境 - COM ============
# fizzstudio.fizzdragon.com

# ============ Java Backend ============
JAVA_STUDIO_URL=https://fizzdragon.com/studio
JAVA_CONTENT_URL=https://fizzdragon.com/content

# ============ AI ============
ALIBABA_API_KEY=sk-0484a407126d4f50adaed6a6762b30ca
ALIBABA_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
AI_MODEL=qwen3-max

# ============ Server ============
PORT=3001
