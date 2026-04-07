# Fizzdragon Platform 生产环境部署指南

## 环境概览

| 环境           | 域名                      | 服务器                | env 文件              |
| -------------- | ------------------------- | --------------------- | --------------------- |
| Production COM | fizzstudio.fizzdragon.com | 新加坡 47.237.115.136 | `.env.production.com` |
| Production CN  | fizzstudio.fizzspace.cn   | CN 服务器             | `.env.production.cn`  |
| Staging        | test.fizzdragon.com       | —                     | `.env.staging`        |
| Local          | localhost                 | 本机                  | `.env.local`          |

## 服务架构

```
Nginx (80/443)
  └→ fizzdragon-web (Next.js :3000)
       └→ fizzdragon-server (NestJS :3001)
             └→ Java Backend (外部)
             └→ Alibaba AI API (外部)
```

两个容器通过 Docker Compose 内部网络通信，Web 通过 `http://server:3001` 访问 Server。

---

## 一、服务器初始化（仅首次）

### 1. 安装 Docker

```bash
# 添加 Docker CE 官方源
dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo

# 安装 libcgroup 依赖（阿里云系统默认没有）
rpm -ivh https://vault.centos.org/centos/8-stream/BaseOS/x86_64/os/Packages/libcgroup-0.41-19.el8.x86_64.rpm

# 安装 Docker
dnf install -y docker-ce docker-ce-cli containerd.io

# 启动并设为开机自启
systemctl enable --now docker
docker --version
```

### 2. 安装 Nginx

```bash
# 添加 nginx 官方源
cat > /etc/yum.repos.d/nginx.repo << 'EOF'
[nginx-stable]
name=nginx stable repo
baseurl=http://nginx.org/packages/centos/8/x86_64/
gpgcheck=0
enabled=1
EOF

# 安装并启动
dnf install -y nginx
systemctl enable --now nginx
nginx -v
```

### 3. 创建目录

```bash
mkdir -p /opt/fizzdragon/platform
mkdir -p /etc/nginx/ssl
```

---

## 二、配置 HTTPS 证书

### 1. 上传证书（本地执行）

```bash
# COM 环境
scp fizzstudio.fizzdragon.com.key fizzstudio.fizzdragon.com.pem root@<服务器IP>:/etc/nginx/ssl/

# CN 环境
scp fizzstudio.fizzspace.cn.key fizzstudio.fizzspace.cn.pem root@<服务器IP>:/etc/nginx/ssl/
```

### 2. 上传 Nginx 配置（本地执行）

```bash
# COM 环境
scp deploy/nginx/fizzstudio.fizzdragon.com.conf root@<服务器IP>:/etc/nginx/conf.d/

# CN 环境
scp deploy/nginx/fizzstudio.fizzspace.cn.conf root@<服务器IP>:/etc/nginx/conf.d/
```

### 3. 验证并重载

```bash
nginx -t && systemctl reload nginx
```

---

## 三、构建 Docker 镜像（本地执行）

### 1. 构建 Web 镜像

```bash
# 加载对应环境变量（以 COM 为例）
source apps/web/.env.production.com

# 构建（注意 --platform linux/amd64，因为本地 Mac 是 ARM）
docker build --platform linux/amd64 -t fizzdragon-web-com \
  --build-arg NEXT_PUBLIC_OSS_BASE_URL=$NEXT_PUBLIC_OSS_BASE_URL \
  --build-arg SERVER_URL=$SERVER_URL \
  --build-arg JAVA_STUDIO_URL=$JAVA_STUDIO_URL \
  --build-arg JAVA_CONTENT_URL=$JAVA_CONTENT_URL \
  -f apps/web/Dockerfile .
```

CN 环境：

```bash
source apps/web/.env.production.cn

docker build --platform linux/amd64 -t fizzdragon-web-cn \
  --build-arg NEXT_PUBLIC_OSS_BASE_URL=$NEXT_PUBLIC_OSS_BASE_URL \
  --build-arg SERVER_URL=$SERVER_URL \
  --build-arg JAVA_STUDIO_URL=$JAVA_STUDIO_URL \
  --build-arg JAVA_CONTENT_URL=$JAVA_CONTENT_URL \
  -f apps/web/Dockerfile .
```

### 2. 构建 Server 镜像

```bash
# Server 镜像不区分环境（环境变量运行时注入）
docker build --platform linux/amd64 -t fizzdragon-server-com -f apps/server/Dockerfile .
docker build --platform linux/amd64 -t fizzdragon-server-cn -f apps/server/Dockerfile .
```

### 3. 导出镜像

```bash
# COM
docker save fizzdragon-web-com fizzdragon-server-com | gzip > fizzdragon-com.tar.gz

# CN
docker save fizzdragon-web-cn fizzdragon-server-cn | gzip > fizzdragon-cn.tar.gz
```

---

## 四、部署（上传到服务器）

### 1. 上传文件（本地执行）

```bash
# COM 环境
scp fizzdragon-com.tar.gz deploy/docker-compose.yml deploy/.env.production.com root@47.237.115.136:/opt/fizzdragon/platform/

# CN 环境
scp fizzdragon-cn.tar.gz deploy/docker-compose.yml deploy/.env.production.cn root@<CN服务器IP>:/opt/fizzdragon/platform/
```

### 2. 服务器上启动

```bash
cd /opt/fizzdragon/platform

# 加载镜像
docker load < fizzdragon-com.tar.gz  # 或 fizzdragon-cn.tar.gz

# 启动服务（使用对应环境的 env 文件）
docker compose --env-file .env.production.com up -d   # COM
docker compose --env-file .env.production.cn up -d     # CN

# 确认运行状态
docker ps
```

---

## 五、更新部署

代码更新后的完整流程：

```bash
# 1. 本地构建新镜像
source apps/web/.env.production.com
docker build --platform linux/amd64 -t fizzdragon-web-com \
  --build-arg NEXT_PUBLIC_OSS_BASE_URL=$NEXT_PUBLIC_OSS_BASE_URL \
  --build-arg SERVER_URL=$SERVER_URL \
  --build-arg JAVA_STUDIO_URL=$JAVA_STUDIO_URL \
  --build-arg JAVA_CONTENT_URL=$JAVA_CONTENT_URL \
  -f apps/web/Dockerfile .
docker build --platform linux/amd64 -t fizzdragon-server-com -f apps/server/Dockerfile .

# 2. 导出
docker save fizzdragon-web-com fizzdragon-server-com | gzip > fizzdragon-com.tar.gz

# 3. 上传
scp fizzdragon-com.tar.gz root@47.237.115.136:/opt/fizzdragon/platform/

# 4. 服务器上重启
ssh root@47.237.115.136 "cd /opt/fizzdragon/platform && docker load < fizzdragon-com.tar.gz && docker compose --env-file .env.production.com up -d"
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

## 七、常用运维命令

```bash
# 查看容器状态
docker ps

# 查看日志
docker logs -f fizzdragon-web      # Web 日志
docker logs -f fizzdragon-server   # Server 日志

# 重启服务
cd /opt/fizzdragon/platform
docker compose --env-file .env.production.com restart

# 停止服务
docker compose --env-file .env.production.com down

# 重载 nginx（改配置后）
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
├── DEPLOY.md                        # 本文档
├── docker-compose.yml               # 通用 compose（所有环境共用）
├── .env.production.com              # 生产 COM 环境变量
├── .env.production.cn               # 生产 CN 环境变量
├── .env.staging                     # 测试环境变量
├── .env.local                       # 本地开发环境变量
└── nginx/
    ├── fizzstudio.fizzdragon.com.conf   # COM nginx 配置
    └── fizzstudio.fizzspace.cn.conf     # CN nginx 配置
```

### 服务器上

```
/opt/fizzdragon/platform/
├── docker-compose.yml               # compose 文件
├── .env.production.com              # 环境变量（COM）或 .env.production.cn（CN）
└── fizzdragon-com.tar.gz            # 镜像包（部署后可删除释放空间）

/etc/nginx/
├── conf.d/
│   └── fizzstudio.fizzdragon.com.conf   # 或 fizzstudio.fizzspace.cn.conf
└── ssl/
    ├── fizzstudio.fizzdragon.com.pem
    └── fizzstudio.fizzdragon.com.key
```
