#!/usr/bin/env bash
#
# FizzDragon prod-com 部署脚本（GitOps，无 GitHub Actions）
# ---------------------------------------------------------------------------
# 流程：az acr build 用「不可变 git-sha」打镜像 → push ACR
#       → 改 main 的 values.yaml 镜像 tag → commit/push
#       → ArgoCD 渲染 Helm、把集群对齐成 git（自动同步）
#
# 为什么这样：唯一真相是 git 的 deploy/helm/fizzdragon/values.yaml。
#   - 不可变 sha tag：新代码=新 tag=values.yaml 必变=ArgoCD 必重部署
#     （根治「重复 push 同名 tag → ArgoCD 看不出变化 → 不部署 → 跑旧镜像」）
#   - 绝不 kubectl set image / helm upgrade 直推：那会和 ArgoCD selfHeal 打架
#   - 构建放 ACR（az acr build）：不吃 GitHub 分钟、不占本机、原生 amd64
#
# 用法：
#   deploy/deploy-com-aks.sh <service...>     # 只部指定服务（推荐，外科手术式）
#   deploy/deploy-com-aks.sh all              # 全部 5 个
#   服务名：web studio admin-ui server agent
#
# 前提：① 已 az login 到 fizzdragon-ai-prod ② 工作区干净 ③ 在 main 分支
#       （prod 只从 main 出；ArgoCD 盯 main）。覆盖：FORCE=1 跳过分支检查。
set -euo pipefail

# --- config ---------------------------------------------------------------
SUBSCRIPTION="5d94f40f-701f-45e1-ab4b-0e1506104ebd"   # fizzdragon-ai-prod
ACR="acrfizzdragoncom"
REGISTRY="acrfizzdragoncom.azurecr.io"
VALUES="deploy/helm/fizzdragon/values.yaml"
WEB_ENV="apps/web/.env.production.com"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# 服务 → "镜像名:Dockerfile:values路径(逗号分隔多个)"
# 用 case 函数而非 declare -A:macOS 自带 /bin/bash 是 3.2,不支持关联数组。
svc_spec() {
  case "$1" in
    web)      echo "fizzdragon-web:apps/web/Dockerfile:.web" ;;
    studio)   echo "fizzdragon-studio:apps/studio/Dockerfile:.studio" ;;
    admin-ui) echo "fizzdragon-admin-ui:apps/admin-ui/Dockerfile:.adminUi" ;;
    server)   echo "fizzdragon-server:apps/server/Dockerfile:.server" ;;
    agent)    echo "fizzdragon-agent:apps/agent/Dockerfile:.agent,.agentWorker" ;;
    *)        return 1 ;;
  esac
}

# --- args -----------------------------------------------------------------
if [ "$#" -eq 0 ]; then
  echo "用法: $0 <service...> | all   (服务: web studio admin-ui server agent)" >&2
  exit 2
fi
if [ "$1" = "all" ]; then
  SERVICES=(web studio admin-ui server agent)
else
  SERVICES=("$@")
fi
for s in "${SERVICES[@]}"; do
  svc_spec "$s" >/dev/null || { echo "未知服务: $s" >&2; exit 2; }
done

# --- guards ---------------------------------------------------------------
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" != "main" ] && [ "${FORCE:-0}" != "1" ]; then
  echo "✋ 当前分支是 '$BRANCH'，prod 只应从 main 部署（ArgoCD 盯 main）。" >&2
  echo "   先 merge develop → main，或用 FORCE=1 覆盖。" >&2
  exit 1
fi
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "✋ 工作区有未提交改动——sha tag 必须如实对应已提交代码。先 commit/stash。" >&2
  exit 1
fi
az account show >/dev/null 2>&1 || { echo "✋ 未登录 az，请先 az login。" >&2; exit 1; }
az account set --subscription "$SUBSCRIPTION"

SHA="$(git rev-parse HEAD)"
SHORT="${SHA:0:7}"
echo "▶ 部署 [${SERVICES[*]}] @ ${SHORT}  (registry=$REGISTRY)"

# --- build (az acr build, 镜像在 ACR 里构建) ------------------------------
build_one() {
  local svc="$1" image="$2" dockerfile="$3"
  local args=()
  case "$svc" in
    web)
      # 13 个 build-arg 来自 .env.production.com；SERVER_URL 用集群内地址覆盖
      while IFS= read -r line; do
        [[ "$line" =~ ^[A-Z_]+= ]] && args+=(--build-arg "$line")
      done < <(grep -E '^[A-Z_]+=' "$WEB_ENV")
      args+=(--build-arg "SERVER_URL=http://fizzdragon-server:3001")
      ;;
    admin-ui)
      args+=(--build-arg "NEXT_PUBLIC_ADMIN_UI_BASE_PATH=/")
      ;;
    # studio / server / agent: 无 build-arg（运行时读 env）
  esac
  echo "  · 构建 $image:$SHORT …"
  az acr build --registry "$ACR" \
    --image "${image}:${SHA}" \
    --file "$dockerfile" \
    --platform linux/amd64 \
    ${args[@]+"${args[@]}"} \
    .
}

# awk 改某 repository 块的下一行 tag（自动覆盖 agent 的两处块），不依赖 yq
bump_tag() {  # $1=镜像名(repository)  $2=新tag
  awk -v repo="$1" -v tag="$2" '
    $0 ~ ("^[[:space:]]*repository:[[:space:]]*" repo "[[:space:]]*$") { print; armed=1; next }
    armed && $0 ~ "^[[:space:]]*tag:" { sub(/tag:.*/, "tag: " tag); armed=0 }
    { print }
  ' "$VALUES" > "$VALUES.tmp" && mv "$VALUES.tmp" "$VALUES"
}

for s in "${SERVICES[@]}"; do
  IFS=":" read -r image dockerfile _paths <<< "$(svc_spec "$s")"
  build_one "$s" "$image" "$dockerfile"
done

# --- bump values.yaml (只动本次构建的服务) --------------------------------
echo "▶ 更新 $VALUES 的 tag → $SHA"
for s in "${SERVICES[@]}"; do
  IFS=":" read -r image _dockerfile _paths <<< "$(svc_spec "$s")"
  bump_tag "$image" "$SHA"
done
git --no-pager diff -- "$VALUES" || true

# --- commit + push (ArgoCD 自动收敛) --------------------------------------
if git diff --quiet -- "$VALUES"; then
  echo "ℹ tag 未变化（已是 $SHORT），无需提交。"
  exit 0
fi
git add "$VALUES"
git commit -m "deploy(com): ${SERVICES[*]} -> ${SHORT}"
git push origin "$BRANCH"
echo "✅ 已推送。ArgoCD 将自动同步（约几分钟）。查看：kubectl -n fizzdragon-com get deploy"
