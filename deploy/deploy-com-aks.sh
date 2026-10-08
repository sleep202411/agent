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

# Recovery: --resume-build <full-source-sha> <service=acr-run-id>...
# Reuses explicitly identified successful runs. New application inputs discard
# these recovery runs and automatically build a fresh, coherent release cycle.
# --- args -----------------------------------------------------------------
RESUME_SHA=""
RUN_IDS=()
if [ "${1:-}" = "--resume-build" ]; then
  [ "$#" -ge 3 ] || { echo "Usage: $0 --resume-build <full-sha> <service=run-id>..." >&2; exit 2; }
  RESUME_SHA="$2"
  [[ "$RESUME_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "Full source SHA required" >&2; exit 2; }
  shift 2
  SERVICES=()
  for entry in "$@"; do
    [[ "$entry" =~ ^[a-z-]+=[a-zA-Z0-9_-]+$ ]] || { echo "Expected service=run-id" >&2; exit 2; }
    SERVICES+=("${entry%%=*}")
    RUN_IDS+=("${entry#*=}")
  done
fi
if [ "$#" -eq 0 ]; then
  echo "用法: $0 <service...> | all   (服务: web studio admin-ui server agent agent-os)" >&2
  exit 2
fi
if [ -n "$RESUME_SHA" ]; then
  : # Services and run IDs were parsed together above.
elif [ "$1" = "all" ]; then
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
START_SHA="$(git rev-parse HEAD)"
SHA="$START_SHA"
if [ -n "$RESUME_SHA" ]; then
  git merge-base --is-ancestor "$RESUME_SHA" "$START_SHA" || { echo "Build source must be an ancestor of HEAD" >&2; exit 1; }
  SHA="$RESUME_SHA"
fi
# Refuse stale/diverged releases before spending time building images.
fetch_branch() {
  git fetch --no-tags --no-write-fetch-head origin "refs/heads/$BRANCH:refs/remotes/origin/$BRANCH" || return 1
  git rev-parse "refs/remotes/origin/$BRANCH"
}
REMOTE_SHA="$(fetch_branch)"
if ! git merge-base --is-ancestor "$REMOTE_SHA" "$START_SHA" && ! git merge-base --is-ancestor "$START_SHA" "$REMOTE_SHA"; then
  echo "✋ Push the source commit and integrate origin/$BRANCH before deployment." >&2
  exit 1
fi

# A SHA-tagged image must contain only that commit, including its build args.
# Untracked files and edits made while ACR builds never enter this snapshot.
BUILD_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/fizz-com-build.XXXXXX")"
PUBLISH_ROOT="$BUILD_ROOT/publish"
cleanup() {
  git -C "$ROOT" worktree remove --force "$PUBLISH_ROOT" >/dev/null 2>&1 || true
  rm -rf "$BUILD_ROOT"
}
trap cleanup EXIT
cp "$ROOT/deploy/release_revision.py" "$ROOT/deploy/release_images.py" "$ROOT/deploy/cn_registry.py" "$BUILD_ROOT/"
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
  # Azure CLI suppresses all result output with --no-wait, including --query.
  # --no-logs waits for this build and returns its Run object without streaming logs.
  local run_id
  run_id="$(cd "$BUILD_ROOT/context" && \
    ${acr_env[@]+"${acr_env[@]}"} az acr build --registry "$ACR" \
      --image "${image}:${SHA}" \
      --file "$dockerfile" \
      --platform linux/amd64 \
      --no-logs --query runId -o tsv \
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

# Every cycle builds one coherent source revision. A changed application tree
# restarts the service set; deployment-only commits do not invalidate images.
next_source() {
  python3 "$BUILD_ROOT/release_revision.py" "$ROOT" "$SHA" "$BRANCH"
}
cycle=0
while true; do
  cycle=$((cycle + 1))
  [ "$cycle" -le 10 ] || { echo "Too many source updates; images retained. Rerun when commits settle." >&2; exit 1; }
  candidate="$(next_source)"
  if [ "$candidate" != "$SHA" ]; then
    SHA="$candidate"
    RESUME_SHA=""
  fi
  SHORT="${SHA:0:7}"
  rm -rf "$BUILD_ROOT/context"
  mkdir "$BUILD_ROOT/context"
  git archive "$SHA" | tar -x -C "$BUILD_ROOT/context"
  restart=0
index=0
IMAGE_TAGS=()
IMAGE_DIGESTS=()
for s in "${SERVICES[@]}"; do
  IFS=":" read -r image dockerfile _paths <<< "$(svc_spec "$s")"
  selected_tag="$SHA"
  if [ -n "$RESUME_SHA" ]; then
    run_id="${RUN_IDS[$index]}"
    wait_for_acr_image "$run_id" "$image" "$SHA"
    run_digest="$(az acr task show-run --registry "$ACR" --run-id "$run_id" --query "outputImages[?repository == '$image' && tag == '$SHA'].digest | [0]" -o tsv | tr -d '\r')"
    current_digest="$(az acr repository show --name "$ACR" --image "$image:$SHA" --query digest -o tsv | tr -d '\r')"
    if [[ ! "$run_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || [ "$run_digest" != "$current_digest" ]; then
      echo "ACR image digest no longer matches successful run $run_id; refusing publication." >&2
      exit 1
    fi
  else
    reuse="$(python3 "$BUILD_ROOT/release_images.py" com "$ROOT" "$SHA" "$s")"
    if [ "$reuse" = BUILD ]; then
      build_one "$s" "$image" "$dockerfile"
    else
      read -r selected_tag reused_digest <<< "$reuse"
      echo "  · Reusing verified $image:$selected_tag ($reused_digest); no build"
    fi
  fi
  selected_digest="$(az acr repository show --name "$ACR" --image "$image:$selected_tag" --query digest -o tsv | tr -d '\r')"
  [[ "$selected_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "Invalid image digest" >&2; exit 1; }
  if [ "${reuse:-BUILD}" != BUILD ] && [ -z "$RESUME_SHA" ] && [ "$selected_digest" != "$reused_digest" ]; then
    echo "Reused image changed; refusing publication" >&2; exit 1
  fi
  IMAGE_TAGS+=("$selected_tag")
  IMAGE_DIGESTS+=("$selected_digest")
  index=$((index + 1))
  candidate="$(next_source)"
  if [ "$candidate" != "$SHA" ]; then
    SHA="$candidate"
    RESUME_SHA=""
    restart=1
    break
  fi
done
[ "$restart" = 0 ] || continue

# Publish from an isolated checkout of the latest remote branch. The source SHA
# stays pinned even when the operator edits, switches branches or commits.
image_tags() {
  git show "$1:$VALUES" | awk -v repo="$2" '
    $0 ~ ("^[[:space:]]*repository:[[:space:]]*" repo "[[:space:]]*$") { armed=1; next }
    armed && $0 ~ "^[[:space:]]*tag:" { print $2; armed=0 }
  ' | tr -d '\"' | sort -u
}
published=0
for attempt in 1 2 3 4 5; do
  cd "$ROOT"
  CURRENT_REMOTE_SHA="$(fetch_branch)"
  candidate="$(next_source)"
  if [ "$candidate" != "$SHA" ]; then
    SHA="$candidate"; RESUME_SHA=""; restart=1; break
  fi
  PUBLISH_BASE="$CURRENT_REMOTE_SHA"
  if ! git merge-base --is-ancestor "$SHA" "$PUBLISH_BASE"; then
    git merge-base --is-ancestor "$PUBLISH_BASE" "$SHA" || { echo "Publication history diverged" >&2; exit 1; }
    PUBLISH_BASE="$SHA"
  fi
  for s in "${SERVICES[@]}"; do
    IFS=":" read -r image _dockerfile _paths <<< "$(svc_spec "$s")"
    before="$(image_tags "$REMOTE_SHA" "$image")"
    current="$(image_tags "$CURRENT_REMOTE_SHA" "$image")"
    [ -n "$current" ] || { echo "Missing image configuration for $image" >&2; exit 1; }
    for tag in $current; do
      if git cat-file -e "$tag^{commit}" 2>/dev/null; then
        git merge-base --is-ancestor "$tag" "$SHA" || {
          echo "A newer or divergent $image release ($tag) is already published; refusing rollback." >&2; exit 1;
        }
      elif [ "$current" != "$before" ]; then
        echo "Concurrent $image publication cannot be ordered safely; refusing overwrite." >&2; exit 1
      fi
    done
  done
  if [ ! -d "$PUBLISH_ROOT" ]; then
    git worktree add --detach "$PUBLISH_ROOT" "$PUBLISH_BASE"
  else
    # Only our disposable publishing worktree is reset, never the user's checkout.
    git -C "$PUBLISH_ROOT" reset --hard "$PUBLISH_BASE"
  fi
  cd "$PUBLISH_ROOT"
  index=0
  for s in "${SERVICES[@]}"; do
    IFS=":" read -r image _dockerfile _paths <<< "$(svc_spec "$s")"
    selected_tag="${IMAGE_TAGS[$index]}"
    current_digest="$(az acr repository show --name "$ACR" --image "$image:$selected_tag" --query digest -o tsv | tr -d '\r')"
    [ "$current_digest" = "${IMAGE_DIGESTS[$index]}" ] || { echo "Image digest changed before publication" >&2; exit 1; }
    bump_tag "$image" "$selected_tag"
    index=$((index + 1))
  done
  if git diff --quiet -- "$VALUES"; then
    published=1
    break
  fi
  git add "$VALUES"
  git -c core.hooksPath=/dev/null commit -m "deploy(com): ${SERVICES[*]} -> ${SHORT}"
  candidate="$(next_source)"
  if [ "$candidate" != "$SHA" ]; then
    SHA="$candidate"; RESUME_SHA=""; restart=1; break
  fi
  if git push origin "HEAD:refs/heads/$BRANCH"; then
    published=1
    break
  fi
  echo "Publication raced with another push or failed; refetching before retry ($attempt/5)."
done
cd "$ROOT"
[ "$restart" = 0 ] || continue
[ "$published" = 1 ] || { echo "Publication did not finish; built images are retained for recovery." >&2; exit 1; }
candidate="$(next_source)"
if [ "$candidate" != "$SHA" ]; then
  SHA="$candidate"; RESUME_SHA=""; continue
fi
break
done
echo "Local checkout preserved. Pull the remote GitOps commit when your worktree is ready."
echo "✅ 镜像和 Git tag 已推送；运行中的版本尚未验证。ArgoCD 将自动同步。"
echo "Published services: ${SERVICES[*]}"
echo "Release source: $SHA (unchanged services may retain older verified image tags)"
echo "Only the selected services were published; other services retain their existing image tags."
echo "Read-only rollout checks (requires AKS read access; use your authorized context):"
index=0
for service in "${SERVICES[@]}"; do
  echo "Expected $service: ${IMAGE_TAGS[$index]} (${IMAGE_DIGESTS[$index]})"
  deployments="fizzdragon-$service"
  [ "$service" != agent ] || deployments="fizzdragon-agent fizzdragon-agent-worker"
  for deployment in $deployments; do
    echo "  kubectl --context aks-fizzdragon-com-admin -n fizzdragon-com get deployment $deployment -o 'jsonpath={.spec.template.spec.containers[*].image}'"
    echo "  kubectl --context aks-fizzdragon-com-admin -n fizzdragon-com rollout status deployment/$deployment --timeout=300s"
  done
  if [ "$service" = server ]; then
    echo "  node deploy/diagnose-com-server.mjs ${IMAGE_TAGS[$index]}"
  fi
  index=$((index + 1))
done
echo "Compare each selected image tag and digest with the expected values above; a ready older deployment is not acceptance of this release."
echo "随后验证已登录的业务接口；/healthz 或 /ready 成功不代表新路由已上线。"
echo "CN release of the same source revision (builds CN images separately):"
echo "  CONFIRM_CN_PROD_MIGRATION=YES deploy/release-cn.sh --tag $SHA --allow-chart-update ${SERVICES[*]}"

}
main "$@"; exit
