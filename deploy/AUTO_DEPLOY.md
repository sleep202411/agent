# Pull-based Auto-Deploy

CI **only builds and pushes** images to GHCR. Each ECS host then
**polls GHCR every ~5 min** and rotates any container whose tag has a
new digest.

```
GitHub Actions ─push→ GHCR (:staging / :production-cn / :production-com)
                        │
                        │  pull (outbound only — no firewall holes)
                        ▼
                  ECS host(s)
                  podman auto-update / Watchtower
```

No SSH from CI. No inbound firewall. No Jenkins.

---

## Tag → environment mapping

| Tag               | Where it runs                          |
| ----------------- | -------------------------------------- |
| `:staging`        | 120.26.152.164 (Podman, staging stack) |
| `:production-cn`  | 120.26.152.164 (Podman, prod-cn stack) |
| `:production-com` | 47.237.115.136 (Docker, Singapore)     |

CI auto-pushes `:staging` on every commit to a deploy branch.
`:production-*` only move via **manual** `workflow_dispatch` on
`main` — see `.github/workflows/build-prod.yml`.

---

## 一次性服务器配置

### 服务器 1 — 120.26.152.164 (Podman, staging + prod-cn)

```bash
ssh ecs-user@120.26.152.164

# 1) 让 ecs-user 的 systemd timer 在登出后还能跑
sudo loginctl enable-linger ecs-user

# 2) 启动 podman-auto-update timer
systemctl --user enable --now podman-auto-update.timer

# 3) 把默认 24h 改成每 5 分钟
mkdir -p ~/.config/systemd/user/podman-auto-update.timer.d
cat > ~/.config/systemd/user/podman-auto-update.timer.d/override.conf <<'EOF'
[Timer]
OnUnitActiveSec=
OnUnitActiveSec=5min
EOF
systemctl --user daemon-reload
systemctl --user restart podman-auto-update.timer

# 4) 验证 timer
systemctl --user list-timers podman-auto-update.timer
# expected: NEXT in <5min, LEFT in <5min, ACTIVATES podman-auto-update.service

# 5) 手动跑一次（dry-run，不会实际更新）
podman auto-update --dry-run
# 列出每个带 io.containers.autoupdate=registry label 的容器，
# 显示当前 digest vs 远端 digest，标注是否会更新。
```

**前提（已经做过的不用重做）：**

- `podman login ghcr.io` 已登录 GHCR（DEPLOY.md 第 224 行）
- 容器是用本仓库的 `deploy/docker-compose.yml` 启动的（已带 label）

如果是已经在跑、还没带 label 的旧容器，需要 recreate 一次（labels 在创建时固定，没法热加）：

```bash
cd /opt/fizzdragon/platform
podman-compose --env-file .env.staging up -d --force-recreate
podman-compose --env-file .env.production.cn up -d --force-recreate
```

---

### 服务器 2 — 47.237.115.136 (Docker, prod-com)

Docker 没有原生的 auto-update，装一个 Watchtower 容器，作用一样：

```bash
ssh root@47.237.115.136

docker run -d \
  --name watchtower \
  --restart always \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /root/.docker/config.json:/config.json:ro \
  containrrr/watchtower \
  --interval 300 \
  --label-enable \
  --cleanup
```

参数：

- `--interval 300` — 5 分钟轮询
- `--label-enable` — 只更新带 `com.centurylinklabs.watchtower.enable=true` label 的容器
- `--cleanup` — 拉新镜像后删旧镜像，省磁盘
- 挂载 `/root/.docker/config.json:ro` — 复用已经 `docker login ghcr.io` 后留下的 GHCR 凭证

如果旧容器还没带 label：

```bash
cd /opt/fizzdragon/platform
docker compose --env-file .env.production.com up -d --force-recreate
```

---

## GitHub repo 配置

CI 需要的 build-args 通过 **GitHub Environments → Variables** 注入。

进 GitHub repo → **Settings → Environments**，确认或创建：

| Environment | Variables (举例)                                                                                                                                                                             |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `staging`   | `NEXT_PUBLIC_OSS_BASE_URL`, `NEXT_PUBLIC_BANNER_BASE_URL`, `NEXT_PUBLIC_USER_BASE_URL`, `NEXT_PUBLIC_SITE_REGION=global`, `NEXT_PUBLIC_PARENT_ORIGIN`, `JAVA_STUDIO_URL`, `JAVA_CONTENT_URL` |
| `prod-cn`   | 同上但指向 prod CN 的值（`NEXT_PUBLIC_SITE_REGION=cn`，等）                                                                                                                                  |
| `prod-com`  | 同上但指向 prod COM 的值（`NEXT_PUBLIC_SITE_REGION=global`）                                                                                                                                 |

工作流文件读 `vars.*` 自动按 environment 注入对应值。

---

## 日常工作流

### 部署到 staging

```bash
git push   # 触发 build-staging.yml → 推 :staging tag → ~5min 后自动滚动
```

### 部署到 prod CN / prod COM

GitHub repo → **Actions → "Build & Push (production)" → Run workflow**，
选 `prod-cn` / `prod-com` / `both`，从 `main` 分支跑。
~5min 后服务器自动滚动。

### 回滚

GitHub repo → **Packages → studio-web →** 选历史 digest →
点 "..." → "Set as latest" 或重新打上 `:staging` / `:production-*` tag。
~5min 后服务器拉到新（旧）digest 自动回滚。

无需 SSH。

---

## 排查

### 看 timer 状态（podman 主机）

```bash
systemctl --user list-timers podman-auto-update.timer
journalctl --user -u podman-auto-update.service --since "1 hour ago"
```

### 强制立刻轮询一次

```bash
# Podman host
systemctl --user start podman-auto-update.service

# Docker host
docker exec watchtower /watchtower --run-once --label-enable
```

### 看每个容器的 auto-update 状态

```bash
# Podman
podman auto-update --dry-run

# Docker
docker logs watchtower --tail 100
```

### 关掉某个容器的自动更新

去掉它在 `docker-compose.yml` 里的两个 label，然后 recreate。
