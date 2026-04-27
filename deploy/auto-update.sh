#!/bin/bash
#
# Pull-based auto-deploy for podman hosts.
#
# Triggered by `podman-auto-update.timer` (every 5 min on ECS). For each
# stack we have an `.env.<stack>` file for, pulls the three :tag images
# from GHCR; if any digest changed we recreate the whole stack with
# podman-compose. Behavior parity with Watchtower on the prod-com host.
#
# Why not `podman auto-update`: that binary expects each container to
# have a corresponding systemd unit (typically Quadlet `.container`
# files), but our containers are managed by `podman-compose` which
# doesn't generate units. Rather than migrate to Quadlet just for one
# host, we run our own cron-style loop here.
#
# Install on the host:
#   sudo install -m 0755 auto-update.sh /home/ecs-user/auto-update.sh
#   mkdir -p ~/.config/systemd/user/podman-auto-update.service.d
#   cat > ~/.config/systemd/user/podman-auto-update.service.d/override.conf <<EOF
#   [Service]
#   ExecStart=
#   ExecStart=/home/ecs-user/auto-update.sh
#   EOF
#   systemctl --user daemon-reload
#   systemctl --user start podman-auto-update.service   # smoke test
#
set -u

DEPLOY_DIR="/opt/fizzdragon/platform"
REGISTRY="ghcr.io/fizzdragon-pte-ltd-2"
IMAGES=(studio-web studio-server studio-agent)

ts() { date +'%Y-%m-%d %H:%M:%S'; }
log() { echo "[$(ts)] $*"; }

cd "$DEPLOY_DIR" || { log "deploy dir $DEPLOY_DIR missing"; exit 1; }

# Auto-discover stacks from .env.<name> files. The GHCR image tag is the
# stack name with dots replaced by hyphens (so .env.production.cn → the
# :production-cn tag), since GHCR doesn't allow dots in tags.
shopt -s nullglob
for envfile in "$DEPLOY_DIR"/.env.*; do
  [ -f "$envfile" ] || continue
  stack="${envfile##*/.env.}"
  tag="${stack//./-}"

  log "checking $stack (tag :$tag)"
  changed=0

  for image in "${IMAGES[@]}"; do
    full="$REGISTRY/$image:$tag"
    before=$(podman image inspect "$full" --format '{{.Id}}' 2>/dev/null || echo "")

    if ! podman pull --quiet "$full" >/dev/null 2>&1; then
      log "  pull failed: $full (skipping)"
      continue
    fi

    after=$(podman image inspect "$full" --format '{{.Id}}' 2>/dev/null || echo "")
    if [ -n "$after" ] && [ "$before" != "$after" ]; then
      log "  $image: ${before:7:12} -> ${after:7:12}"
      changed=1
    fi
  done

  if [ "$changed" = "1" ]; then
    log "recreating $stack stack"
    if podman-compose --env-file "$envfile" up -d --force-recreate 2>&1 | sed "s/^/[$(ts)]   /"; then
      log "$stack stack updated"
    else
      log "$stack recreate failed (containers may be in mixed state)"
    fi
  else
    log "$stack already up-to-date"
  fi
done
