# Fizzdragon Platform 部署指南

## 环境概览

| 环境           | 域名                      | 服务器                | 用户     | 容器运行时 | 镜像来源  | env 文件              |
| -------------- | ------------------------- | --------------------- | -------- | ---------- | --------- | --------------------- |
| Production COM | fizzstudio.fizzdragon.com | 新加坡 47.237.115.136 | root     | Docker     | GHCR pull | `.env.production.com` |
| Production CN  | fizzstudio.fizzspace.cn   | 120.26.152.164        | ecs-user | Podman     | GHCR pull | `.env.production.cn`  |
| Staging        | test.fizzdragon.com       | 120.26.152.164        | ecs-user | Podman     | GHCR pull | `.env.staging`        |

## 服务架构

```
Nginx (80/443)
  └→ fizzdragon-web (TanStack Start :3000)
       └→ fizzdragon-server (NestJS :3001)
             ├→ Redis (6379) — Script Agent 会话状态缓存
             ├→ Java Backend (外部)
             └→ Alibaba AI API (外部)
```

三个容器通过 Docker/Podman Compose 内部网络通信：

- Web 通过 `http://server:3001` 访问 Server
- Server 通过 `redis://redis:6379` 访问 Redis

### Redis

Script Agent（剧本智能体）使用 Redis 缓存会话状态（分析结果、剧集映射等），24 小时自动过期。

**镜像配置**：

- 国内服务器：Docker Hub 被墙，使用 GHCR 镜像 `ghcr.io/fizzdragon-pte-ltd-2/redis:7-alpine`
- 新加坡服务器：直接使用官方 `redis:7-alpine`
- 通过 `REDIS_IMAGE` 环境变量控制（默认 `redis:7-alpine`）

**数据持久化**：使用 Docker named volume `redis_data`，`docker compose down` 不会丢数据，`down -v` 才会清除。

**更新 GHCR Redis 镜像**（当需要升级 Redis 版本时，本地执行）：

```bash
docker pull --platform linux/amd64 redis:7-alpine  # 或新版本号
# 用 buildx 确保 amd64 架构
cat <<'DOCKERFILE' | docker buildx build --platform linux/amd64 -t ghcr.io/fizzdragon-pte-ltd-2/redis:7-alpine --push -
FROM --platform=linux/amd64 redis:7-alpine
DOCKERFILE
```

---

## 一、服务器初始化（仅首次）

### Production 服务器（Docker）

```bash
# 检查 Docker 是否已安装，已安装则跳过
docker --version || {
  # 添加 Docker CE 官方源
  dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo

  # 安装 libcgroup 依赖（阿里云系统默认没有）
  rpm -ivh https://vault.centos.org/centos/8-stream/BaseOS/x86_64/os/Packages/libcgroup-0.41-19.el8.x86_64.rpm

  # 安装 Docker
  dnf install -y docker-ce docker-ce-cli containerd.io

  # 启动并设为开机自启
  systemctl enable --now docker
}

# 检查 Nginx 是否已安装，已安装则跳过
nginx -v || {
  cat > /etc/yum.repos.d/nginx.repo << 'EOF'
[nginx-stable]
name=nginx stable repo
baseurl=http://nginx.org/packages/centos/8/x86_64/
gpgcheck=0
enabled=1
EOF

  dnf install -y nginx
  systemctl enable --now nginx
}

# 创建目录（已存在则自动跳过）
mkdir -p /opt/fizzdragon/platform
mkdir -p /etc/nginx/ssl
```

### Staging 服务器（Podman）

Staging 服务器已预装 Podman + podman-compose，无需额外安装。

```bash
# 创建目录（需要 sudo）
sudo mkdir -p /opt/fizzdragon/platform
sudo chown ecs-user:ecs-user /opt/fizzdragon/platform

# 登录 GHCR（首次）
podman login ghcr.io
```

---

## 二、配置 HTTPS 证书（仅 Production）

```bash
# 上传证书（本地执行）
scp <域名>.key <域名>.pem root@<服务器IP>:/etc/nginx/ssl/

# 上传 Nginx 配置
scp deploy/nginx/<域名>.conf root@<服务器IP>:/etc/nginx/conf.d/

# 验证并重载
nginx -t && systemctl reload nginx
```

---

## 三、构建镜像（本地执行）

> **重要**：
>
> - 本地 Mac 是 ARM 架构，服务器是 x86_64，必须加 `--platform linux/amd64`
> - Web 构建必须传 `--build-arg`，Next.js 通过 `.env.production` 文件读取 `NEXT_PUBLIC_*` 变量（Dockerfile 内部自动生成）
> - `SERVER_URL` 固定为 `http://server:3001`（Docker 内部通信），不要用 env 文件里的 `localhost`
> - 缺少 `NEXT_PUBLIC_OSS_BASE_URL` 会在构建时报错

### 构建 Web 镜像

```bash
# 加载对应环境变量
source apps/web/.env.production.com   # 或 .env.production.cn / .env.staging

# 构建（注意 SERVER_URL 固定为 Docker 内部地址）
docker build --platform linux/amd64 -t ghcr.io/fizzdragon-pte-ltd-2/studio-web:<tag> \
  --build-arg NEXT_PUBLIC_OSS_BASE_URL=$NEXT_PUBLIC_OSS_BASE_URL \
  --build-arg NEXT_PUBLIC_SITE_REGION=$NEXT_PUBLIC_SITE_REGION \
  --build-arg NEXT_PUBLIC_PARENT_ORIGIN=$NEXT_PUBLIC_PARENT_ORIGIN \
  --build-arg SERVER_URL=http://server:3001 \
  --build-arg JAVA_STUDIO_URL=$JAVA_STUDIO_URL \
  --build-arg JAVA_CONTENT_URL=$JAVA_CONTENT_URL \
  -f apps/web/Dockerfile .
```

### 构建 Server 镜像

```bash
docker build --platform linux/amd64 -t ghcr.io/fizzdragon-pte-ltd-2/studio-server:<tag> \
  -f apps/server/Dockerfile .
```

### 环境变量对照表

| 参数                        | Staging                                       | Prod CN                                   | Prod COM                                        |
| --------------------------- | --------------------------------------------- | ----------------------------------------- | ----------------------------------------------- |
| `NEXT_PUBLIC_OSS_BASE_URL`  | `fizzspace-test.oss-cn-hangzhou.aliyuncs.com` | `shotive.oss-cn-hangzhou.aliyuncs.com`    | `fizzstudio-sg.oss-ap-southeast-1.aliyuncs.com` |
| `NEXT_PUBLIC_SITE_REGION`   | `global`                                      | `cn`                                      | `global`                                        |
| `NEXT_PUBLIC_PARENT_ORIGIN` | `https://test.fizzdragon.com`                 | `https://fizzdragon.fizzspace.cn`         | `https://fizzdragon.com`                        |
| `JAVA_STUDIO_URL`           | `https://test.fizzdragon.com/test2`           | `https://fizzdragon.fizzspace.cn/studio`  | `https://fizzdragon.com/studio`                 |
| `JAVA_CONTENT_URL`          | `https://test.fizzdragon.com/test1`           | `https://fizzdragon.fizzspace.cn/content` | `https://fizzdragon.com/content`                |
| Web tag                     | `staging`                                     | `production-cn`                           | `production-com`                                |
| Server tag                  | `staging`                                     | `production-cn`                           | `production-com`                                |

> 环境变量定义在 `apps/web/.env.staging`、`.env.production.cn`、`.env.production.com` 中

---

## 四、部署 — Production COM（Docker + GHCR）

### 首次部署

```bash
# 上传配置文件
scp deploy/docker-compose.yml deploy/.env.production.com root@47.237.115.136:/opt/fizzdragon/platform/

# 服务器登录 GHCR（首次）
ssh root@47.237.115.136 "docker login ghcr.io"

# 拉取并启动
ssh root@47.237.115.136 "cd /opt/fizzdragon/platform && \
  docker compose --env-file .env.production.com pull && \
  docker compose --env-file .env.production.com up -d && \
  docker ps"
```

### 更新部署

```bash
# 服务器：pull 新镜像 + 自动重建容器
cd /opt/fizzdragon/platform
docker compose --env-file .env.production.com pull
docker compose --env-file .env.production.com up -d
```

---

## 五、部署 — Staging + Production CN（Podman + GHCR）

Staging 和 Production CN 部署在同一台服务器（120.26.152.164），通过独立网络隔离。

### 首次部署

```bash
# 上传配置文件
scp deploy/docker-compose.yml deploy/.env.staging deploy/.env.production.cn ecs-user@120.26.152.164:/opt/fizzdragon/platform/

# 服务器登录 GHCR（首次）
ssh ecs-user@120.26.152.164 "podman login ghcr.io"

# 启动 Staging
ssh ecs-user@120.26.152.164 "cd /opt/fizzdragon/platform && \
  podman-compose --env-file .env.staging pull && \
  podman-compose --env-file .env.staging up -d"

# 启动 Production CN
ssh ecs-user@120.26.152.164 "cd /opt/fizzdragon/platform && \
  podman-compose --env-file .env.production.cn pull && \
  podman-compose --env-file .env.production.cn up -d"
```

### 更新部署

```bash
# Staging: pull + 自动重建
cd /opt/fizzdragon/platform
podman-compose --env-file .env.staging pull
podman-compose --env-file .env.staging up -d

# Production CN: pull + 自动重建
podman-compose --env-file .env.production.cn pull
podman-compose --env-file .env.production.cn up -d
```

### 常见问题

**端口被占用**：

```bash
# 查看哪个进程占用
sudo ss -tlnp | grep <端口>
# 杀掉进程
sudo kill <PID>
```

**容器依赖删除顺序**：先删 web 再删 server（web depends_on server）。

**同一台服务器跑多个 compose 项目时网络冲突**：

docker-compose.yml 中必须显式定义独立网络（`networks.app.name: ${COMPOSE_PROJECT_NAME}_network`），否则多个 compose 项目会共用 `platform_default` 网络，导致 `server` 这个 network alias 被多个 server 容器注册。web 请求 `http://server:3001` 时会随机解析到任一 server，造成间歇性的 "Not logged in" 或 "HTTP 404" 错误。

```
# 正确：每个项目独立网络
staging_network:        staging-web + staging-server
production-cn_network:  production-cn-web + production-cn-server

# 错误：共用网络导致 DNS 随机解析
platform_default:       staging-web + staging-server + production-cn-web + production-cn-server
                        → server alias 指向两个容器，随机轮询
```

---

## 六、防火墙 / 安全组

确保阿里云安全组开放以下端口：

| 端口 | 用途               |
| ---- | ------------------ |
| 22   | SSH                |
| 80   | HTTP（跳转 HTTPS） |
| 443  | HTTPS              |

---

## 七、快速部署命令（复制即用）

每次代码更新后，复制对应环境的命令直接执行。

### Staging

```bash
# 1. 本地构建 + 推送
source apps/web/.env.staging
docker build --platform linux/amd64 -t ghcr.io/fizzdragon-pte-ltd-2/studio-web:staging \
  --build-arg NEXT_PUBLIC_OSS_BASE_URL=$NEXT_PUBLIC_OSS_BASE_URL \
  --build-arg NEXT_PUBLIC_SITE_REGION=$NEXT_PUBLIC_SITE_REGION \
  --build-arg NEXT_PUBLIC_PARENT_ORIGIN=$NEXT_PUBLIC_PARENT_ORIGIN \
  --build-arg SERVER_URL=http://server:3001 \
  --build-arg JAVA_STUDIO_URL=$JAVA_STUDIO_URL \
  --build-arg JAVA_CONTENT_URL=$JAVA_CONTENT_URL \
  -f apps/web/Dockerfile .
docker build --platform linux/amd64 -t ghcr.io/fizzdragon-pte-ltd-2/studio-server:staging \
  -f apps/server/Dockerfile .

docker push ghcr.io/fizzdragon-pte-ltd-2/studio-web:staging
docker push ghcr.io/fizzdragon-pte-ltd-2/studio-server:staging

# 2. 服务器部署
ssh ecs-user@120.26.152.164 "cd /opt/fizzdragon/platform && \
  podman-compose --env-file .env.staging pull && \
  podman-compose --env-file .env.staging up -d && \
  docker ps"
```

### Production CN

```bash
# 1. 本地构建 + 推送
source apps/web/.env.production.cn
docker build --platform linux/amd64 -t ghcr.io/fizzdragon-pte-ltd-2/studio-web:production-cn \
  --build-arg NEXT_PUBLIC_OSS_BASE_URL=$NEXT_PUBLIC_OSS_BASE_URL \
  --build-arg NEXT_PUBLIC_SITE_REGION=$NEXT_PUBLIC_SITE_REGION \
  --build-arg NEXT_PUBLIC_PARENT_ORIGIN=$NEXT_PUBLIC_PARENT_ORIGIN \
  --build-arg SERVER_URL=http://server:3001 \
  --build-arg JAVA_STUDIO_URL=$JAVA_STUDIO_URL \
  --build-arg JAVA_CONTENT_URL=$JAVA_CONTENT_URL \
  -f apps/web/Dockerfile .
docker build --platform linux/amd64 -t ghcr.io/fizzdragon-pte-ltd-2/studio-server:production-cn \
  -f apps/server/Dockerfile .

docker push ghcr.io/fizzdragon-pte-ltd-2/studio-web:production-cn
docker push ghcr.io/fizzdragon-pte-ltd-2/studio-server:production-cn

# 2. 服务器部署
ssh ecs-user@120.26.152.164 "cd /opt/fizzdragon/platform && \
  podman-compose --env-file .env.production.cn pull && \
  podman-compose --env-file .env.production.cn up -d && \
  docker ps"
```

### Production COM

```bash
# 1. 本地构建 + 推送
source apps/web/.env.production.com
docker build --platform linux/amd64 -t ghcr.io/fizzdragon-pte-ltd-2/studio-web:production-com \
  --build-arg NEXT_PUBLIC_OSS_BASE_URL=$NEXT_PUBLIC_OSS_BASE_URL \
  --build-arg NEXT_PUBLIC_SITE_REGION=$NEXT_PUBLIC_SITE_REGION \
  --build-arg NEXT_PUBLIC_PARENT_ORIGIN=$NEXT_PUBLIC_PARENT_ORIGIN \
  --build-arg SERVER_URL=http://server:3001 \
  --build-arg JAVA_STUDIO_URL=$JAVA_STUDIO_URL \
  --build-arg JAVA_CONTENT_URL=$JAVA_CONTENT_URL \
  -f apps/web/Dockerfile .
docker build --platform linux/amd64 -t ghcr.io/fizzdragon-pte-ltd-2/studio-server:production-com \
  -f apps/server/Dockerfile .

docker push ghcr.io/fizzdragon-pte-ltd-2/studio-web:production-com
docker push ghcr.io/fizzdragon-pte-ltd-2/studio-server:production-com

# 2. 服务器部署
ssh root@47.237.115.136 "cd /opt/fizzdragon/platform && \
  docker compose --env-file .env.production.com pull && \
  docker compose --env-file .env.production.com up -d && \
  docker ps"
```

### 查看日志

```bash
# Staging
ssh ecs-user@120.26.152.164 "docker logs -f staging-web"
ssh ecs-user@120.26.152.164 "docker logs -f staging-server"

# Production CN
ssh ecs-user@120.26.152.164 "docker logs -f production-cn-web"
ssh ecs-user@120.26.152.164 "docker logs -f production-cn-server"

# Production COM
ssh root@47.237.115.136 "docker logs -f fizzdragon-web"
ssh root@47.237.115.136 "docker logs -f fizzdragon-server"
```

---

## 九、常用运维命令

```bash
# 查看容器状态
docker ps

# 查看日志
docker logs -f fizzdragon-web
docker logs -f fizzdragon-server

# 重启服务（Production）
cd /opt/fizzdragon/platform
docker compose --env-file .env.production.com restart

# 重启服务（Staging）
cd /opt/fizzdragon/platform
podman-compose --env-file .env.staging down
podman-compose --env-file .env.staging up -d

# 重载 nginx
nginx -t && systemctl reload nginx

# 查看端口占用
ss -tlnp

# 清理旧镜像
docker image prune -f
```

---

## 八、文件结构

### 项目内（deploy/）

```
deploy/
├── DEPLOY.md                            # 本文档
├── docker-compose.yml                   # 通用 compose（所有环境共用）
├── .env.production.com                  # 生产 COM 环境变量
├── .env.production.cn                   # 生产 CN 环境变量
├── .env.staging                         # 测试环境变量
├── .env.local                           # 本地开发环境变量
└── nginx/
    ├── fizzstudio.fizzdragon.com.conf   # COM nginx 配置
    └── fizzstudio.fizzspace.cn.conf     # CN nginx 配置
```

### Production 服务器

```
/opt/fizzdragon/platform/
├── docker-compose.yml
├── .env.production.com  (或 .env.production.cn)
└── fizzdragon-com.tar.gz  (部署后可删除)

/etc/nginx/
├── conf.d/<域名>.conf
└── ssl/<域名>.pem + .key
```

### Staging 服务器

```
/opt/fizzdragon/platform/
├── docker-compose.yml
└── .env.staging
```

镜像通过 GHCR pull，不需要上传 tar.gz。

### GHCR 镜像地址

```
ghcr.io/fizzdragon-pte-ltd-2/studio-web:staging
ghcr.io/fizzdragon-pte-ltd-2/studio-server:staging
ghcr.io/fizzdragon-pte-ltd-2/studio-web:production-cn
ghcr.io/fizzdragon-pte-ltd-2/studio-server:production-cn
ghcr.io/fizzdragon-pte-ltd-2/studio-web:production-com
ghcr.io/fizzdragon-pte-ltd-2/studio-server:production-com
ghcr.io/fizzdragon-pte-ltd-2/redis:7-alpine              # 国内服务器使用（Docker Hub 被墙）
```

---

## 十、服务器清单

| 服务器     | IP             | 用户     | 系统                  | 容器运行时                      | 用途                    |
| ---------- | -------------- | -------- | --------------------- | ------------------------------- | ----------------------- |
| 新加坡 ECS | 47.237.115.136 | root     | Alibaba Cloud Linux 3 | Docker 26.1.3 + Nginx 1.28.3    | Production COM          |
| 国内 ECS   | 120.26.152.164 | ecs-user | Alibaba Cloud Linux 3 | Podman 4.9.4 + Nginx (手动编译) | Staging + Production CN |

### 国内 ECS (120.26.152.164)

- **内存**: 16GB / **磁盘**: 99GB
- **用户**: ecs-user（非 root，有 sudo 权限）
- **Podman** 4.9.4 + **podman-compose** 1.0.6（`docker` 命令实际调用 podman）
- **Nginx 路径**: `/usr/local/nginx/`（手动编译，非 dnf 安装）
- **Nginx 配置**: `/usr/local/nginx/conf/conf.d/`
- **Nginx 证书**: `/usr/local/nginx/conf/cert/`
- **Nginx 重载**: `sudo /usr/local/nginx/sbin/nginx -s reload`

#### 端口分配

| 端口      | 服务                       |
| --------- | -------------------------- |
| 22        | SSH                        |
| 80/443    | Nginx                      |
| 3000/3001 | Staging (web/server)       |
| 3002/3003 | Production CN (web/server) |
| 8088-8091 | Java 服务                  |

#### Nginx 站点列表

| 文件                            | 域名                       | 用途           |
| ------------------------------- | -------------------------- | -------------- |
| fizzstudio.fizzspace.cn.conf    | fizzstudio.fizzspace.cn    | 新平台 CN 生产 |
| studio.test.fizzdragon.com.conf | studio.test.fizzdragon.com | 新平台 Staging |
| test.fizzdragon.com.conf        | test.fizzdragon.com        | 旧平台测试     |
| test.fizzspace.cn.conf          | test.fizzspace.cn          | 旧平台国内测试 |
| app.shotive.cn.conf             | app.shotive.cn             | 旧应用         |
| app.shotive.net.conf            | app.shotive.net            | 旧应用         |

### 新加坡 ECS (47.237.115.136)

- **用户**: root
- **Docker**: 26.1.3 / **Nginx**: 1.28.3（标准路径 `/etc/nginx/`）
- **Nginx 配置**: `/etc/nginx/conf.d/fizzstudio.fizzdragon.com.conf`
- **Nginx 证书**: `/etc/nginx/ssl/`

#### 端口分配

| 端口      | 服务                        |
| --------- | --------------------------- |
| 22        | SSH                         |
| 80/443    | Nginx                       |
| 3000/3001 | Production COM (web/server) |
| 8443      | OpenVPN                     |
