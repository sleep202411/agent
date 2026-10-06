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
#   服务名：web studio admin-ui server agent agent-os
#
# 前提：① 已 az login 到 fizzdragon-ai-prod ② 工作区干净 ③ 在 main 分支
#       （prod 只从 main 出；ArgoCD 盯 main）。覆盖：FORCE=1 跳过分支检查。
# Parse the complete release procedure before executing any long-running build.
# Otherwise Bash can resume reading at an obsolete byte offset if git/editor
# changes this file during ACR execution. Keep exit in the same parsed command.
main() {
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
    # Agent OS worker (LangGraph runtime). Not in `all`: build it explicitly.
    agent-os) echo "fizzdragon-agent-os:apps/agent-os/Dockerfile:.agentOs" ;;
    *)        return 1 ;;
  esac
}

# --- args -----------------------------------------------------------------
if [ "$#" -eq 0 ]; then
  echo "用法: $0 <service...> | all   (服务: web studio admin-ui server agent agent-os)" >&2
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
SHA="$(git rev-parse HEAD)"
# Refuse stale/diverged releases before spending time building images.
fetch_branch() {
  git fetch --no-tags origin "refs/heads/$BRANCH" || return 1
  git rev-parse FETCH_HEAD
}
REMOTE_SHA="$(fetch_branch)"
if ! git merge-base --is-ancestor "$REMOTE_SHA" "$SHA"; then
  echo "✋ origin/$BRANCH has changes missing locally. Integrate them and rerun deployment." >&2
  exit 1
fi

# A SHA-tagged image must contain only that commit, including its build args.
# Untracked files and edits made while ACR builds never enter this snapshot.
BUILD_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/fizz-com-build.XXXXXX")"
trap 'rm -rf "$BUILD_ROOT"' EXIT
mkdir "$BUILD_ROOT/context"
git archive "$SHA" | tar -x -C "$BUILD_ROOT/context"
WEB_ENV="$BUILD_ROOT/context/$WEB_ENV"
az account show >/dev/null 2>&1 || { echo "✋ 未登录 az，请先 az login。" >&2; exit 1; }
az account set --subscription "$SUBSCRIPTION"

SHORT="${SHA:0:7}"
echo "▶ 部署 [${SERVICES[*]}] @ ${SHORT}  (registry=$REGISTRY)"

# Windows Git Bash: az acr build 流式日志含 Unicode（如 U+2022 •），GBK 控制台会
# UnicodeEncodeError 误报失败。轮询本次提交的 run ID，避免流式日志。
# AZ_ACR_BUILD_NO_LOGS=1 also enables the Windows encoding/path safeguards.
is_windows_acr_cli() {
  [ "${AZ_ACR_BUILD_NO_LOGS:-}" = "1" ] && return 0
  case "$(uname -s 2>/dev/null)" in
    MINGW* | MSYS* | CYGWIN* | Windows*) return 0 ;;
  esac
  case "${OSTYPE:-}" in
    msys* | cygwin*) return 0 ;;
  esac
  [ "${OS:-}" = "Windows_NT" ] && return 0
  [ -n "${WINDIR:-}" ] && return 0
  return 1
}

if is_windows_acr_cli; then
  export PYTHONUTF8=1
  export AZURE_CORE_NO_COLOR=true
fi

wait_for_acr_image() {
  local run_id="$1" repo="$2" tag="$3" run_status
  echo "  · 等待 ACR run $run_id ($repo:$tag) …"
  local deadline=$((SECONDS + 3600))
  while [ "$SECONDS" -lt "$deadline" ]; do
    run_status="$(az acr task show-run --registry "$ACR" --run-id "$run_id" --query status -o tsv)"
    run_status="${run_status//$'\r'/}"
    case "$run_status" in
      Succeeded)
        # Check this run's outputs, not a tag left behind by an older build.
        if [ "$(az acr task show-run --registry "$ACR" --run-id "$run_id" \
          --query "length(outputImages[?repository == '$repo' && tag == '$tag'])" -o tsv | tr -d '\r')" != "1" ]; then
          echo "✋ ACR run $run_id did not produce $repo:$tag." >&2
          return 1
        fi
        return 0 ;;
      Queued|Started|Running) echo "  · 构建中 ($run_status)…" ;;
      *)
        echo "✋ ACR run $run_id ended with status '$run_status'." >&2
        echo "az acr task logs --registry $ACR --run-id $run_id > build.log" >&2
        return 1 ;;
    esac
    sleep 20
  done
  echo "✋ Timed out waiting for ACR run $run_id; inspect it before retrying." >&2
  return 1
}

# --- build (az acr build, 镜像在 ACR 里构建) ------------------------------
build_one() {
  local svc="$1" image="$2" dockerfile="$3" target="${4:-}"
  local args=()
  case "$svc" in
    web)
      # Build args from .env.production.com only — strip CR (Windows) so values
      # never bake as `/studio\r` or corrupt NEXT_PUBLIC_* in the client bundle.
      while IFS= read -r line || [ -n "$line" ]; do
        line="${line//$'\r'/}"
        [[ "$line" =~ ^NEXT_PUBLIC_[A-Z0-9_]+= ]] && args+=(--build-arg "$line")
      done < "$WEB_ENV"
      args+=(--build-arg "SERVER_URL=http://fizzdragon-server:3001")
      args+=(--build-arg "JAVA_STUDIO_URL=$(grep -E '^JAVA_STUDIO_URL=' "$WEB_ENV" | tail -1 | cut -d= -f2- | tr -d '\r')")
      args+=(--build-arg "JAVA_CONTENT_URL=$(grep -E '^JAVA_CONTENT_URL=' "$WEB_ENV" | tail -1 | cut -d= -f2- | tr -d '\r')")
      ;;
    admin-ui)
      args+=(--build-arg "NEXT_PUBLIC_ADMIN_UI_BASE_PATH=/")
      ;;
    studio)
      # Java URLs + SITE_REGION are baked into the studio bundle at BUILD time
      # (next.config rewrites + NEXT_PUBLIC inlining; see apps/studio/Dockerfile).
      # Pass them explicitly — the fallback happens to be the .com host here, but
      # relying on it is what sent .cn's auth + register links to the wrong host.
      args+=(--build-arg "AURORA_PROXY_TARGET=http://fizzdragon-server:3001")
      args+=(--build-arg "AURORA_STRIP_PREFIX=1")
      args+=(--build-arg "$(grep -E '^JAVA_STUDIO_URL=' "$WEB_ENV")")
      args+=(--build-arg "$(grep -E '^JAVA_CONTENT_URL=' "$WEB_ENV")")
      args+=(--build-arg "$(grep -E '^NEXT_PUBLIC_SITE_REGION=' "$WEB_ENV")")
      ;;
    # server / agent: 无 build-arg（运行时读 env）
  esac
  echo "  · 构建 $image:$SHORT …"
  if [ -n "$target" ]; then
    args+=(--target "$target")
  fi
  # Git Bash MSYS converts `/studio` → `E:/Git/studio` when passing --build-arg
  # to az.exe, baking broken NEXT_PUBLIC_API_*_PREFIX into the client bundle.
  local acr_env=()
  if is_windows_acr_cli; then
    acr_env=(env MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*')
  fi
  local run_id
  run_id="$(cd "$BUILD_ROOT/context" && \
    ${acr_env[@]+"${acr_env[@]}"} az acr build --registry "$ACR" \
      --image "${image}:${SHA}" \
      --file "$dockerfile" \
      --platform linux/amd64 \
      --no-wait --query runId -o tsv \
      ${args[@]+"${args[@]}"} .)"
  run_id="${run_id//$'\r'/}"
  if [[ ! "$run_id" =~ ^[a-zA-Z0-9_-]+$ ]]; then
    echo "✋ ACR did not return a valid run ID; no deployment will be published." >&2
    return 1
  fi
  wait_for_acr_image "$run_id" "$image" "$SHA"
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

# Do not overwrite concurrent edits or publish an old build over newer code.
CURRENT_REMOTE_SHA="$(fetch_branch)"
if [ "$CURRENT_REMOTE_SHA" != "$REMOTE_SHA" ] || \
   [ "$(git rev-parse HEAD)" != "$SHA" ] || \
   [ "$(git rev-parse --abbrev-ref HEAD)" != "$BRANCH" ] || \
   ! git diff --quiet || ! git diff --cached --quiet; then
  echo "✋ Branch or tracked files changed during the build. Changes are preserved; reconcile and rerun deployment." >&2
  exit 1
fi

# --- bump values.yaml (只动本次构建的服务) --------------------------------
echo "▶ 更新 $VALUES 的 tag → $SHA"
for s in "${SERVICES[@]}"; do
  IFS=":" read -r image _dockerfile _paths <<< "$(svc_spec "$s")"
  bump_tag "$image" "$SHA"
done
git --no-pager diff -- "$VALUES" || true

# --- commit + push (ArgoCD 自动收敛) --------------------------------------
if git diff --quiet -- "$VALUES"; then
  echo "ℹ tag 未变化（已是 ${SHORT}），无需提交。"
  exit 0
fi
git add "$VALUES"
git commit -m "deploy(com): ${SERVICES[*]} -> ${SHORT}"
git push origin "$BRANCH"
echo "✅ 镜像和 Git tag 已推送；运行中的版本尚未验证。ArgoCD 将自动同步。"
echo "只读检查 Server rollout（需要 AKS / ArgoCD 读取权限）："
echo "  node deploy/diagnose-com-server.mjs $SHA"
echo "随后验证已登录的业务接口；/healthz 或 /ready 成功不代表新路由已上线。"

}
main "$@"; exit
