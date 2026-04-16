# FizzDragon Platform

Turborepo monorepo for FizzDragon Studio — AI-powered video content creation platform.

## Project Structure

```
apps/
  web/            TanStack Start + Vite 前端（Studio + 主站）
  server/         NestJS 后端（AI Agent + Assistant）
packages/
  ui/             共享 UI 组件
  eslint-config/  ESLint 配置
  typescript-config/  TypeScript 配置
deploy/
  docker-compose.yml       通用 Docker Compose
  .env.production.com      生产 COM 环境变量
  .env.production.cn       生产 CN 环境变量
  .env.staging             测试环境变量
  .env.local               本地环境变量
  nginx/                   Nginx 配置
  DEPLOY.md                部署指南
```

## Getting Started

```bash
# 安装依赖
npm install

# 启动所有服务
npm run dev

# 只启动前端
npx turbo dev --filter=web

# 只启动后端
npx turbo dev --filter=server
```

| Service              | URL                   |
| -------------------- | --------------------- |
| Web (TanStack Start) | http://localhost:3000 |
| Server (NestJS)      | http://localhost:3001 |

## Environment Variables

### Web (`apps/web/.env.local`)

```bash
JAVA_CONTENT_URL=http://120.26.152.164:8091
JAVA_STUDIO_URL=http://120.26.152.164:8090
SERVER_URL=http://localhost:3001
VITE_OSS_BASE_URL=https://fizzspace-test.oss-cn-hangzhou.aliyuncs.com
```

### Server (`apps/server/.env`)

```bash
JAVA_STUDIO_URL=http://120.26.152.164:8090
JAVA_CONTENT_URL=http://120.26.152.164:8091
ALIBABA_API_KEY=sk-xxx
ALIBABA_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
AI_MODEL=qwen3-max
PORT=3001
```

参考 `apps/web/.env.example` 和 `apps/server/.env.example` 获取完整变量列表。

## Build

```bash
# 构建所有
npm run build

# 单独构建
npx turbo build --filter=web
npx turbo build --filter=server
```

## Docker Deployment

详细部署指南见 [`deploy/DEPLOY.md`](deploy/DEPLOY.md)。

### 快速构建

```bash
# 加载环境变量
source apps/web/.env.production.com

# 构建镜像（Mac 需要 --platform linux/amd64）
docker build --platform linux/amd64 -t fizzdragon-web-com \
  --build-arg VITE_OSS_BASE_URL=$VITE_OSS_BASE_URL \
  --build-arg SERVER_URL=$SERVER_URL \
  --build-arg JAVA_STUDIO_URL=$JAVA_STUDIO_URL \
  --build-arg JAVA_CONTENT_URL=$JAVA_CONTENT_URL \
  -f apps/web/Dockerfile .

docker build --platform linux/amd64 -t fizzdragon-server-com \
  -f apps/server/Dockerfile .

# 导出
docker save fizzdragon-web-com fizzdragon-server-com | gzip > fizzdragon-com.tar.gz
```

### 服务器部署

```bash
# 上传到服务器
scp fizzdragon-com.tar.gz deploy/docker-compose.yml deploy/.env.production.com root@<IP>:/opt/fizzdragon/platform/

# 服务器上启动
cd /opt/fizzdragon/platform
docker load < fizzdragon-com.tar.gz
docker compose --env-file .env.production.com up -d
```

### 多环境

使用同一个 `docker-compose.yml`，通过 `--env-file` 切换环境：

```bash
docker compose --env-file .env.production.com up -d   # COM 生产
docker compose --env-file .env.production.cn up -d     # CN 生产
docker compose --env-file .env.staging up -d           # 测试
docker compose --env-file .env.local up -d             # 本地
```

## Architecture

```
User → Nginx (443/HTTPS)
         ↓
       Web container (3000)
         ↓ (Docker internal: http://server:3001)
       Server container (3001)
         ↓
       Java Backend (external)
       Alibaba AI API (external)
```

## Branch Strategy

```
main              ← Production, merge via PR only
  ↑
develop           ← Staging, daily development
  ↑
feature/*         ← Feature branches, PR to develop
hotfix/*          ← Hotfixes, PR to main + develop
```

### 开发流程

1. 从 develop 创建 feature 分支
2. 开发完成后 PR to develop
3. CI 通过后 merge 到 develop
4. 验证没问题后，develop merge 到 main（部署 production）
