# Fizzdragon Platform 部署指南

## 环境概览

| 环境           | 域名                      | 服务器                | 用户     | 容器运行时 | 镜像来源       | env 文件              |
| -------------- | ------------------------- | --------------------- | -------- | ---------- | -------------- | --------------------- |
| Production COM | fizzstudio.fizzdragon.com | 新加坡 47.237.115.136 | root     | Docker     | 本地构建 + scp | `.env.production.com` |
| Production CN  | fizzstudio.fizzspace.cn   | CN 服务器             | root     | Docker     | 本地构建 + scp | `.env.production.cn`  |
| Staging        | test.fizzdragon.com       | 120.26.152.164        | ecs-user | Podman     | GHCR pull      | `.env.staging`        |

## 服务架构

```
Nginx (80/443)
  └→ fizzdragon-web (Next.js :3000)
       └→ fizzdragon-server (NestJS :3001)
             └→ Java Backend (外部)
             └→ Alibaba AI API (外部)
```

两个容器通过 Docker/Podman Compose 内部网络通信，Web 通过 `http://server:3001` 访问 Server。

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

> **重要**：本地 Mac 是 ARM 架构，服务器是 x86_64，必须加 `--platform linux/amd64`。

### 构建 Web 镜像

```bash
# 加载对应环境变量
source apps/web/.env.production.com   # 或 .env.production.cn / .env.staging

# 构建
docker build --platform linux/amd64 -t fizzdragon-web-<env> \
  --build-arg NEXT_PUBLIC_OSS_BASE_URL=$NEXT_PUBLIC_OSS_BASE_URL \
  --build-arg SERVER_URL=$SERVER_URL \
  --build-arg JAVA_STUDIO_URL=$JAVA_STUDIO_URL \
  --build-arg JAVA_CONTENT_URL=$JAVA_CONTENT_URL \
  --build-arg NEXT_PUBLIC_SITE_REGION=$NEXT_PUBLIC_SITE_REGION \
  -f apps/web/Dockerfile .
```

### 构建 Server 镜像

```bash
docker build --platform linux/amd64 -t fizzdragon-server-<env> -f apps/server/Dockerfile .
```

---

## 四、部署 — Production（Docker + scp）

### 1. 导出镜像

```bash
docker save fizzdragon-web-com fizzdragon-server-com | gzip > fizzdragon-com.tar.gz
```

### 2. 上传

```bash
scp fizzdragon-com.tar.gz deploy/docker-compose.yml deploy/.env.production.com root@47.237.115.136:/opt/fizzdragon/platform/
```

### 3. 服务器上启动

```bash
cd /opt/fizzdragon/platform
docker load < fizzdragon-com.tar.gz
docker compose --env-file .env.production.com up -d
docker ps
```

### 更新部署

```bash
# 本地：构建 + 导出 + 上传（同上）

# 服务器：加载 + 重启
cd /opt/fizzdragon/platform
docker load < fizzdragon-com.tar.gz
docker compose --env-file .env.production.com up -d
```

---

## 五、部署 — Staging（Podman + GHCR）

### 1. 本地推送镜像到 GHCR

```bash
# 打 tag（注意拼写）
docker tag fizzdragon-web-staging ghcr.io/fizzdragon-pte-ltd-2/studio-web:staging
docker tag fizzdragon-server-staging ghcr.io/fizzdragon-pte-ltd-2/studio-server:staging

# 推送（增量推送，只传变化的 layer）
docker push ghcr.io/fizzdragon-pte-ltd-2/studio-web:staging
docker push ghcr.io/fizzdragon-pte-ltd-2/studio-server:staging
```

### 2. 上传配置文件

```bash
scp deploy/docker-compose.yml deploy/.env.staging ecs-user@120.26.152.164:/opt/fizzdragon/platform/
```

### 3. 服务器上拉取并启动

```bash
# 停旧容器（如有）
docker stop fizzdragon-web fizzdragon-server 2>/dev/null
docker rm fizzdragon-web fizzdragon-server 2>/dev/null

# 拉取新镜像
podman pull ghcr.io/fizzdragon-pte-ltd-2/studio-web:staging
podman pull ghcr.io/fizzdragon-pte-ltd-2/studio-server:staging

# 启动
cd /opt/fizzdragon/platform
podman-compose --env-file .env.staging up -d
docker ps
```

### 更新部署

```bash
# 本地：构建 + tag + push 到 GHCR（同上步骤 1）

# 服务器：停旧 + pull 新 + 启动
cd /opt/fizzdragon/platform
docker stop fizzdragon-web fizzdragon-server
docker rm fizzdragon-web fizzdragon-server
podman pull ghcr.io/fizzdragon-pte-ltd-2/studio-web:staging
podman pull ghcr.io/fizzdragon-pte-ltd-2/studio-server:staging
podman-compose --env-file .env.staging up -d
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
docker build --platform linux/amd64 -t fizzdragon-web-staging \
  --build-arg NEXT_PUBLIC_OSS_BASE_URL=$NEXT_PUBLIC_OSS_BASE_URL \
  --build-arg SERVER_URL=$SERVER_URL \
  --build-arg JAVA_STUDIO_URL=$JAVA_STUDIO_URL \
  --build-arg JAVA_CONTENT_URL=$JAVA_CONTENT_URL \
  --build-arg NEXT_PUBLIC_SITE_REGION=$NEXT_PUBLIC_SITE_REGION \
  -f apps/web/Dockerfile .
docker build --platform linux/amd64 -t fizzdragon-server-staging -f apps/server/Dockerfile .

docker tag fizzdragon-web-staging ghcr.io/fizzdragon-pte-ltd-2/studio-web:staging
docker tag fizzdragon-server-staging ghcr.io/fizzdragon-pte-ltd-2/studio-server:staging
docker push ghcr.io/fizzdragon-pte-ltd-2/studio-web:staging
docker push ghcr.io/fizzdragon-pte-ltd-2/studio-server:staging

# 2. 服务器部署
ssh ecs-user@120.26.152.164 "cd /opt/fizzdragon/platform && \
  podman pull ghcr.io/fizzdragon-pte-ltd-2/studio-web:staging && \
  podman pull ghcr.io/fizzdragon-pte-ltd-2/studio-server:staging && \
  podman stop staging-web staging-server 2>/dev/null; \
  podman rm staging-web staging-server 2>/dev/null; \
  podman-compose --env-file .env.staging up -d && \
  docker ps"
```

### Production CN

```bash
# 1. 本地构建 + 推送
source apps/web/.env.production.cn
docker build --platform linux/amd64 -t fizzdragon-web-cn \
  --build-arg NEXT_PUBLIC_OSS_BASE_URL=$NEXT_PUBLIC_OSS_BASE_URL \
  --build-arg SERVER_URL=$SERVER_URL \
  --build-arg JAVA_STUDIO_URL=$JAVA_STUDIO_URL \
  --build-arg JAVA_CONTENT_URL=$JAVA_CONTENT_URL \
  --build-arg NEXT_PUBLIC_SITE_REGION=cn \
  -f apps/web/Dockerfile .
docker build --platform linux/amd64 -t fizzdragon-server-cn -f apps/server/Dockerfile .

docker tag fizzdragon-web-cn ghcr.io/fizzdragon-pte-ltd-2/studio-web:production-cn
docker tag fizzdragon-server-cn ghcr.io/fizzdragon-pte-ltd-2/studio-server:production-cn
docker push ghcr.io/fizzdragon-pte-ltd-2/studio-web:production-cn
docker push ghcr.io/fizzdragon-pte-ltd-2/studio-server:production-cn

# 2. 服务器部署
ssh ecs-user@120.26.152.164 "cd /opt/fizzdragon/platform && \
  podman pull ghcr.io/fizzdragon-pte-ltd-2/studio-web:production-cn && \
  podman pull ghcr.io/fizzdragon-pte-ltd-2/studio-server:production-cn && \
  podman stop production-cn-web production-cn-server 2>/dev/null; \
  podman rm production-cn-web production-cn-server 2>/dev/null; \
  podman-compose --env-file .env.production.cn up -d && \
  docker ps"
```

### Production COM

```bash
# 1. 本地构建 + 导出
source apps/web/.env.production.com
docker build --platform linux/amd64 -t fizzdragon-web-com \
  --build-arg NEXT_PUBLIC_OSS_BASE_URL=$NEXT_PUBLIC_OSS_BASE_URL \
  --build-arg SERVER_URL=$SERVER_URL \
  --build-arg JAVA_STUDIO_URL=$JAVA_STUDIO_URL \
  --build-arg JAVA_CONTENT_URL=$JAVA_CONTENT_URL \
  --build-arg NEXT_PUBLIC_SITE_REGION=global \
  -f apps/web/Dockerfile .
docker build --platform linux/amd64 -t fizzdragon-server-com -f apps/server/Dockerfile .
docker save fizzdragon-web-com fizzdragon-server-com | gzip > fizzdragon-com.tar.gz

# 2. 上传 + 部署
scp fizzdragon-com.tar.gz root@47.237.115.136:/opt/fizzdragon/platform/
ssh root@47.237.115.136 "cd /opt/fizzdragon/platform && \
  docker load < fizzdragon-com.tar.gz && \
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
