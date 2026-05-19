# Pull-based Auto-Deploy

CI **only builds and pushes** images to GHCR. Each host **polls GHCR every
~5 min** and rotates any container whose tag has a new digest. CI never
SSHs into a server, no inbound firewall holes, no Jenkins.

```
GitHub Actions ─push→ GHCR (:staging / :production-cn / :production-com)
                        │
                        │  pull (outbound only)
                        ▼
                  ECS host(s)
              ┌──────────┴──────────┐
              ▼                     ▼
    auto-update.sh (Podman)   Watchtower (Docker)
    on 120.26.152.164         on 47.237.115.136
    (staging + prod-cn)       (prod-com)
```

## Tag → host mapping

| Tag               | Host           | Runtime | Update mechanism             |
| ----------------- | -------------- | ------- | ---------------------------- |
| `:staging`        | 120.26.152.164 | Podman  | `auto-update.sh` (this repo) |
| `:production-cn`  | 120.26.152.164 | Podman  | `auto-update.sh` (this repo) |
| `:production-com` | 47.237.115.136 | Docker  | `containrrr/watchtower`      |

`:staging` is pushed automatically on every commit to `develop`
(`build-staging.yml`). `:production-cn` and `:production-com` only move via
**manual `workflow_dispatch`** on `main` (`build-prod.yml`) — that dispatch
click is the one and only human gate before prod ships.

## Why not `podman auto-update`?

Podman's built-in `auto-update` binary expects each container to have a
matching systemd unit (typically generated via Quadlet `.container` files)
so it can pull the new image and `systemctl restart <unit>` to recreate.

We manage stacks with `podman-compose`, which does **not** generate per-
container systemd units — the containers carry a
`PODMAN_SYSTEMD_UNIT=podman-compose@platform.service` label that points to
a unit which doesn't exist. `podman auto-update` pulls the new image, then
fails on the restart step and rolls the image tag back.

Migrating the whole stack to Quadlet would diverge the prod `docker-
compose.yml` from local-dev Docker. So we keep Compose as the single
source of truth and run `auto-update.sh` (this repo's `deploy/`
directory) — same idea as Watchtower, just in 50 lines of bash, reusing
the existing `podman-auto-update.timer` for scheduling.

## One-time host setup

### Host 1 — `120.26.152.164` (Podman, staging + prod-cn)

```bash
ssh ecs-user@120.26.152.164

# 1) Let the user's systemd timers run when no shell is logged in
sudo loginctl enable-linger ecs-user

# 2) Enable the timer and override its default `daily` cadence to 5 min
systemctl --user enable --now podman-auto-update.timer

mkdir -p ~/.config/systemd/user/podman-auto-update.timer.d
cat > ~/.config/systemd/user/podman-auto-update.timer.d/override.conf <<'EOF'
[Timer]
OnCalendar=
OnCalendar=*:0/5
RandomizedDelaySec=0
EOF
systemctl --user daemon-reload
systemctl --user restart podman-auto-update.timer

# 3) Install the update script (file lives at deploy/auto-update.sh)
#    From your laptop:
#      scp deploy/auto-update.sh ecs-user@120.26.152.164:/home/ecs-user/auto-update.sh
chmod +x ~/auto-update.sh

# 4) Replace the timer's ExecStart with our script + give it room to finish
mkdir -p ~/.config/systemd/user/podman-auto-update.service.d
cat > ~/.config/systemd/user/podman-auto-update.service.d/override.conf <<'EOF'
[Service]
ExecStart=
ExecStart=/home/ecs-user/auto-update.sh
TimeoutStartSec=600
KillMode=process
EOF
systemctl --user daemon-reload

# 5) Smoke test
systemctl --user start podman-auto-update.service
journalctl --user -u podman-auto-update.service --since "2 min ago" | tail -40
```

`KillMode=process` is critical: without it, when the script exits, systemd
treats every podman / conmon child process as part of its own cgroup and
SIGKILLs the freshly-started containers. With it, only the script itself
gets reaped.

The script auto-discovers stacks from `/opt/fizzdragon/platform/.env.<name>`
files and maps each one to the GHCR tag with dots replaced by hyphens (so
`.env.production.cn` → `:production-cn`). To add a new stack: drop in an
env file. No script edits needed.

For compose stacks, the `server` container runs `npm run db:deploy` before
binding HTTP. That keeps the in-docker Postgres schema in step with the
pulled server image during auto-update; a failed migration keeps the server
container restarting instead of serving traffic against the wrong schema.

If existing containers were created before the `watchtower.enable` /
`autoupdate=registry` labels landed in `docker-compose.yml` (those labels
freeze at creation time and can't be patched on a running container),
recreate them once:

```bash
cd /opt/fizzdragon/platform
podman-compose --env-file .env.staging      up -d --force-recreate
podman-compose --env-file .env.production.cn up -d --force-recreate
```

### Host 2 — `47.237.115.136` (Docker, prod-com)

```bash
ssh root@47.237.115.136

# 1) Make sure GHCR creds exist (one-time; reuses ~/.docker/config.json)
docker login ghcr.io -u <github-username>   # paste a PAT with read:packages

# 2) Run Watchtower as a permanent sidecar
docker run -d \
  --name watchtower \
  --restart always \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /root/.docker/config.json:/config.json:ro \
  -e WATCHTOWER_LABEL_ENABLE=true \
  -e WATCHTOWER_POLL_INTERVAL=300 \
  -e WATCHTOWER_CLEANUP=true \
  -e WATCHTOWER_INCLUDE_RESTARTING=true \
  containrrr/watchtower:latest

# 3) Verify
docker logs watchtower --tail 50
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /root/.docker/config.json:/config.json:ro \
  -e WATCHTOWER_LABEL_ENABLE=true \
  containrrr/watchtower:latest --run-once --debug 2>&1 \
  | grep -E "Found|Scanned|Updated"
# Expect "Scanned=4 Updated=0" — the four labeled containers
# (web/server/agent/agent-worker) sync'd with GHCR. Redis has no label
# on purpose: we don't want auto-rotation on the data store.
```

`WATCHTOWER_LABEL_ENABLE=true` makes Watchtower only touch containers
carrying `com.centurylinklabs.watchtower.enable=true` — exactly the four
business containers in `docker-compose.yml`.

If existing containers predate the label, recreate once:

```bash
cd /opt/fizzdragon/platform
docker compose --env-file .env.production.com up -d --force-recreate
```

## Day-to-day workflow

### Ship to staging

```bash
git push origin develop      # → build-staging.yml → :staging → ~5 min auto-roll
```

### Ship to prod-cn / prod-com

GitHub → **Actions → "Build & Push (production)" → Run workflow** from the
`main` branch, pick `prod-cn` / `prod-com` / `both`. CI builds and pushes
the matching `:production-*` tag; ~5 min later the host auto-rolls.

### Roll back

GitHub → **Packages → studio-web** → pick a previous digest → re-tag as
`:staging` / `:production-*`. ~5 min later the host pulls the new (older)
digest and recreates. No SSH needed.

## Troubleshooting

### Trigger a check immediately

```bash
# Podman host
systemctl --user start podman-auto-update.service
journalctl --user -u podman-auto-update.service --since "1 min ago" | tail -50

# Docker host
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /root/.docker/config.json:/config.json:ro \
  -e WATCHTOWER_LABEL_ENABLE=true \
  containrrr/watchtower:latest --run-once --debug
```

### Inspect the schedule

```bash
# Podman host
systemctl --user list-timers podman-auto-update.timer

# Docker host (tail the persistent watchtower container)
docker logs watchtower --tail 100 --follow
```

### A container won't auto-update

Verify it carries the label:

```bash
# Podman
podman inspect <name> --format '{{index .Config.Labels "io.containers.autoupdate"}}'

# Docker
docker inspect <name> --format '{{index .Config.Labels "com.centurylinklabs.watchtower.enable"}}'
```

If the value is empty, the container was created before the label landed
in `docker-compose.yml`. Force-recreate it (see one-time setup sections
above).

### Disable auto-update for one container

Drop both labels (`io.containers.autoupdate` + `com.centurylinklabs.watchtower.enable`)
from that service in `docker-compose.yml`, then recreate.
